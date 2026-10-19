/* WoW Toolbox · changelog feed
   Reads the latest published changelog entries from the Supabase project the
   desktop app uses and draws them into #changelog-feed as a release feed.
   Plain fetch against the public REST endpoint with the publishable key, which
   is designed to be public: row level security limits an anonymous caller to
   published rows. No SDK and no websocket; the feed refetches on load, when
   the tab becomes visible again, and every few minutes while it stays visible.
   Every failure ends in a short neutral message so the rest of the page is
   never affected. Rows are untrusted data: API text only reaches the DOM
   through textContent, never through innerHTML. */

(() => {
  const SUPABASE_URL = 'https://sxwbyrumbiedxawtirmc.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_w3EsysKqDxVTdFOL3uybKw_Q-6YbeC1';
  const FEED_LIMIT = 5;
  const FEED_URL =
    `${SUPABASE_URL}/rest/v1/changelogs` +
    `?select=id,version,published_at,items&is_published=eq.true&order=published_at.desc&limit=${FEED_LIMIT}`;
  const RELEASES_URL = 'https://github.com/Isidorsson/wow-toolbox/releases';

  const POLL_MS = 5 * 60 * 1000;   // polite refresh, only while the tab is visible
  const MIN_GAP_MS = 30 * 1000;    // a tab flicker should not refetch
  const TIMEOUT_MS = 10 * 1000;    // a stalled request can't leave the panel loading forever
  const VISIBLE_ITEMS = 4;         // a long entry shows this many items collapsed
  const COLLAPSE_ABOVE = 5;        // one hidden leftover isn't worth a toggle

  // The app's category order. Anything else the API sends lands in "other".
  const CATEGORIES = [
    ['added', 'Added'],
    ['improved', 'Improved'],
    ['fixed', 'Fixed'],
    ['removed', 'Removed'],
    ['known_issues', 'Known issues'],
    ['other', 'Other'],
  ];

  const STATUS_LABEL = {
    idle: 'Idle',
    loading: 'Connecting',
    live: 'Live',
    offline: 'Offline',
    empty: 'No entries',
  };

  const feed = document.getElementById('changelog-feed');
  const body = document.getElementById('feed-body');
  const status = document.getElementById('feed-status');
  const meta = document.getElementById('feed-meta');
  if (!feed || !body || !status || !meta) return;

  const state = {
    inflight: null,     // AbortController of the request in flight
    pollTimer: 0,
    lastFetchAt: 0,
    signature: '',      // what is on screen, so an unchanged poll doesn't redraw
    hasContent: false,
  };
  const openIds = new Set();        // entries the reader expanded, kept across redraws
  const entryIds = new WeakMap();   // entry element -> row id

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const RELATIVE_UNITS = [
    ['year', 365 * DAY], ['month', 30 * DAY], ['week', 7 * DAY],
    ['day', DAY], ['hour', HOUR], ['minute', MINUTE],
  ];

  /* ── Parsing: trust nothing the API sends ─────────────────────────── */

  const isRecord = (value) => typeof value === 'object' && value !== null;

  const parseGroups = (rawItems) => {
    const byCategory = new Map(CATEGORIES.map(([key]) => [key, []]));
    for (const item of Array.isArray(rawItems) ? rawItems : []) {
      if (!isRecord(item) || typeof item.text !== 'string' || !item.text.trim()) continue;
      const key = byCategory.has(item.category) ? item.category : 'other';
      byCategory.get(key).push(item.text.trim());
    }
    return CATEGORIES
      .map(([key, label]) => ({ key, label, texts: byCategory.get(key) }))
      .filter((group) => group.texts.length > 0);
  };

  const parseEntry = (row) => {
    if (!isRecord(row) || typeof row.version !== 'string' || !row.version.trim()) return null;
    const groups = parseGroups(row.items);
    if (groups.length === 0) return null;
    const published = new Date(typeof row.published_at === 'string' ? row.published_at : NaN);
    return {
      id: typeof row.id === 'string' ? row.id : row.version,
      version: row.version.trim(),
      publishedAt: Number.isNaN(published.getTime()) ? null : published.toISOString(),
      groups,
    };
  };

  const parseRows = (json) => {
    if (!Array.isArray(json)) throw new Error('unexpected-shape');
    return json.slice(0, FEED_LIMIT).map(parseEntry).filter((entry) => entry !== null);
  };

  /* ── Formatting ───────────────────────────────────────────────────── */

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const formatRelative = (iso, now) => {
    const diff = new Date(iso).getTime() - now;
    for (const [unit, ms] of RELATIVE_UNITS) {
      if (Math.abs(diff) >= ms) return rtf.format(Math.trunc(diff / ms), unit);
    }
    return 'just now';
  };

  /* ── DOM ──────────────────────────────────────────────────────────── */

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const setState = (next) => {
    feed.dataset.state = next;
    status.textContent = STATUS_LABEL[next];
  };

  // The status pill at the bottom of the page shows the newest version too.
  const setVersionField = (value) => {
    document.querySelectorAll('[data-field="changelog"]').forEach((node) => {
      node.textContent = value;
    });
  };

  const renderMessage = (text) => {
    const link = el('a', '', 'See the releases on GitHub');
    link.href = RELEASES_URL;
    link.rel = 'noopener';
    const message = el('p', 'feed__msg', `${text} `);
    message.append(link, '.');
    body.replaceChildren(message);
  };

  const renderSkeleton = () => {
    const skeleton = el('div', 'feed__skel');
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.append(el('i'), el('i'), el('i'));
    body.replaceChildren(skeleton);
  };

  const setOpen = (node, open) => {
    node.dataset.open = String(open);
    const toggle = node.querySelector('.entry__more');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Show fewer' : `Show all ${node.dataset.total}`;
  };

  const renderHead = (entry, isLatest, total) => {
    const head = el('header', 'entry__head');
    head.append(el('h3', 'entry__v', entry.version));
    if (isLatest) head.append(el('span', 'entry__latest', 'Latest'));
    if (entry.publishedAt) {
      const time = el('time', '', formatDate(entry.publishedAt));
      time.dateTime = entry.publishedAt;
      const ago = el('span', '', formatRelative(entry.publishedAt, Date.now()));
      ago.dataset.at = entry.publishedAt;
      const when = el('p', 'entry__when');
      when.append(time, ' · ', ago);
      head.append(when);
    }
    head.append(el('p', 'entry__count', `${total} ${total === 1 ? 'item' : 'items'}`));
    return head;
  };

  const renderGroups = (entry, collapsible) => {
    const groups = [];
    let seen = 0;
    for (const group of entry.groups) {
      const node = el('div', 'group');
      node.dataset.cat = group.key;
      if (collapsible && seen >= VISIBLE_ITEMS) node.classList.add('is-extra');
      const list = el('ul');
      for (const text of group.texts) {
        list.append(el('li', collapsible && seen >= VISIBLE_ITEMS ? 'is-extra' : '', text));
        seen += 1;
      }
      node.append(el('h4', 'cat', group.label), list);
      groups.push(node);
    }
    return groups;
  };

  const renderEntry = (entry, isLatest) => {
    const total = entry.groups.reduce((sum, group) => sum + group.texts.length, 0);
    const collapsible = total > COLLAPSE_ABOVE;
    const node = el('article', 'entry');
    node.dataset.total = String(total);
    entryIds.set(node, entry.id);
    node.append(renderHead(entry, isLatest, total), ...renderGroups(entry, collapsible));
    if (collapsible) {
      const toggle = el('button', 'entry__more');
      toggle.type = 'button';
      node.append(toggle);
    }
    setOpen(node, !collapsible || openIds.has(entry.id));
    return node;
  };

  const updateRelativeTimes = () => {
    const now = Date.now();
    body.querySelectorAll('[data-at]').forEach((node) => {
      node.textContent = formatRelative(node.dataset.at, now);
    });
  };

  body.addEventListener('click', (e) => {
    const toggle = e.target instanceof Element ? e.target.closest('.entry__more') : null;
    const node = toggle?.closest('.entry');
    if (!node) return;
    const open = node.dataset.open !== 'true';
    setOpen(node, open);
    const id = entryIds.get(node);
    if (open) openIds.add(id);
    else openIds.delete(id);
  });

  /* ── Feed state ───────────────────────────────────────────────────── */

  const show = (entries) => {
    if (entries.length === 0) {
      state.signature = '';
      state.hasContent = false;
      renderMessage('No release notes have been published yet.');
      meta.textContent = '';
      setVersionField('n/a');
      setState('empty');
      return;
    }
    const signature = JSON.stringify(entries);
    if (signature !== state.signature) {
      body.replaceChildren(...entries.map((entry, i) => renderEntry(entry, i === 0)));
      state.signature = signature;
    }
    state.hasContent = true;
    meta.textContent = `Latest ${entries.length}`;
    setVersionField(entries[0].version);
    updateRelativeTimes();
    setState('live');
  };

  // A failed refresh keeps whatever is already on screen; only a first load
  // that never succeeded falls back to the neutral message.
  const showOffline = () => {
    setState('offline');
    if (state.hasContent) return;
    renderMessage('Release notes are unavailable right now.');
    meta.textContent = '';
    setVersionField('n/a');
  };

  const fetchEntries = async (signal) => {
    const res = await fetch(FEED_URL, { headers: { apikey: PUBLISHABLE_KEY }, signal });
    if (!res.ok) throw new Error(`http-${res.status}`);
    return parseRows(await res.json());
  };

  // Never rejects: every failure becomes the offline state.
  const refresh = async () => {
    window.clearTimeout(state.pollTimer);
    state.inflight?.abort();
    const controller = new AbortController();
    state.inflight = controller;
    const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    if (!state.hasContent) {
      setState('loading');
      renderSkeleton();
    }
    try {
      const entries = await fetchEntries(controller.signal);
      if (state.inflight !== controller) return;
      state.lastFetchAt = Date.now();
      show(entries);
    } catch {
      if (state.inflight === controller) showOffline();
    } finally {
      window.clearTimeout(timeout);
      if (state.inflight === controller) {
        state.inflight = null;
        schedulePoll();
      }
    }
  };

  const schedulePoll = () => {
    window.clearTimeout(state.pollTimer);
    if (document.hidden) return;
    state.pollTimer = window.setTimeout(() => { void refresh(); }, POLL_MS);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      window.clearTimeout(state.pollTimer);
    } else if (Date.now() - state.lastFetchAt >= MIN_GAP_MS) {
      void refresh();
    } else {
      schedulePoll();
    }
  });

  setState('idle');
  void refresh();
})();
