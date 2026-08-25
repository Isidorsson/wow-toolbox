/* WoW Toolbox · welcome page
   Fetches latest GitHub release and populates the download CTA + meta strip.
   Fails silently into a "view releases" fallback so the page works before
   any build has been published. */

(() => {
  const REPO = 'Isidorsson/wow-toolbox';
  const API  = `https://api.github.com/repos/${REPO}/releases/latest`;
  const REPO_RELEASES = `https://github.com/${REPO}/releases`;

  const $ = (sel) => document.querySelector(sel);

  const ui = {
    ctaDownload:    $('#cta-download'),
    ctaVersion:     $('#cta-version'),
    largeCta:       $('#cta-download-large'),
    largeLabel:     $('#cta-label-large'),
    largeDetail:    $('#cta-detail-large'),
    downloadTag:    $('#download-tag'),
    downloadState:  $('#download-state'),
    releaseMeta:    $('#release-meta'),
  };

  const field = (name) =>
    ui.releaseMeta?.querySelector(`[data-field="${name}"]`) ?? null;

  const formatSize = (bytes) => {
    if (!bytes || !Number.isFinite(bytes)) return '—';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const platformFromAsset = (name = '') => {
    if (/\.(exe|msi)$/i.test(name)) return 'Win x64';
    if (/\.dmg$/i.test(name))       return 'macOS';
    if (/\.(AppImage|deb|rpm)$/i.test(name)) return 'Linux';
    return 'Multi';
  };

  // Prefer a Windows installer; fall back through .msi, any .exe, any asset.
  const pickAsset = (assets = []) => {
    if (!assets.length) return null;
    const byPattern = (re) => assets.find((a) => re.test(a.name || ''));
    return (
      byPattern(/setup.*\.exe$/i) ||
      byPattern(/x64.*\.exe$/i)   ||
      byPattern(/win.*\.exe$/i)   ||
      byPattern(/\.exe$/i)        ||
      byPattern(/\.msi$/i)        ||
      assets[0]
    );
  };

  const setField = (name, value) => {
    const el = field(name);
    if (el) el.textContent = value;
  };

  const showNoRelease = (reason) => {
    if (ui.ctaVersion) ui.ctaVersion.textContent = 'no builds yet';
    if (ui.ctaDownload) {
      ui.ctaDownload.href = REPO_RELEASES;
      const label = ui.ctaDownload.querySelector('.btn__label');
      if (label) label.textContent = 'Watch repo';
    }
    if (ui.largeLabel)  ui.largeLabel.textContent  = 'View on GitHub';
    if (ui.largeDetail) ui.largeDetail.textContent = `github.com/${REPO}`;
    if (ui.largeCta)    ui.largeCta.href = REPO_RELEASES;
    if (ui.downloadTag) {
      ui.downloadTag.textContent = reason
        ? `No build published yet · ${reason}`
        : 'No build published yet — star the repo to get notified when the first release ships.';
    }
    if (ui.downloadState) ui.downloadState.textContent = "No build yet";
    setField('version', 'pending');
    setField('size', '—');
    setField('date', '—');
  };

  const applyRelease = (rel) => {
    const asset   = pickAsset(rel.assets);
    const version = rel.tag_name || rel.name || 'latest';
    const size    = asset ? formatSize(asset.size) : '—';
    const date    = formatDate(rel.published_at);
    const dlUrl   = asset?.browser_download_url || rel.html_url || REPO_RELEASES;
    const plat    = asset ? platformFromAsset(asset.name) : 'Win x64';

    if (ui.ctaVersion) ui.ctaVersion.textContent = version;
    if (ui.ctaDownload) ui.ctaDownload.href = dlUrl;

    if (ui.largeLabel)  ui.largeLabel.textContent  = `Download ${version}`;
    if (ui.largeDetail) ui.largeDetail.textContent = asset?.name || 'from GitHub releases';
    if (ui.largeCta)    ui.largeCta.href = dlUrl;

    if (ui.downloadState) ui.downloadState.textContent = "Ready";
    const assetCount = rel.assets?.length ?? 0;
    if (ui.downloadTag) {
      ui.downloadTag.textContent =
        `Published ${date} · ${size} · ${assetCount} asset${assetCount === 1 ? '' : 's'}`;
    }

    setField('version', version);
    setField('size', size);
    setField('date', date);
    setField('platform', plat);
  };

  fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((res) => {
      if (res.status === 404) throw new Error('no-release');
      if (!res.ok) throw new Error(`http-${res.status}`);
      return res.json();
    })
    .then(applyRelease)
    .catch((err) => {
      const reason = err?.message === 'no-release' ? null : 'GitHub API unreachable';
      showNoRelease(reason);
    });

  // Delivery tile: swap the mocked version rows for the three most recent
  // releases. Stays on the mockup if the API is unreachable or empty.
  const deliveryRows = document.querySelectorAll('#delivery-tile .tile__row[data-release]');
  if (deliveryRows.length) {
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=${deliveryRows.length}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`http-${res.status}`))))
      .then((list) => {
        if (!Array.isArray(list) || list.length === 0) return;
        deliveryRows.forEach((row, i) => {
          const rel = list[i];
          if (!rel) { row.hidden = true; return; }
          const label = row.querySelector('span');
          const state = row.querySelector('b');
          if (label) label.textContent = rel.tag_name || rel.name || '—';
          if (state) state.textContent = i === 0 ? 'shipped' : 'archived';
        });
      })
      .catch(() => { /* keep the static mockup */ });
  }
})();

/* Hero terminal tabs — one tab stop, arrows move the selection. */
(() => {
  const tablist = document.querySelector('.term__tabs[role="tablist"]');
  if (!tablist) return;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];

  const select = (tab, focus = true) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => select(tab, false)));

  tablist.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    if (e.key === 'ArrowLeft')  next = tabs[(i - 1 + tabs.length) % tabs.length];
    if (e.key === 'Home')       next = tabs[0];
    if (e.key === 'End')        next = tabs[tabs.length - 1];
    if (next) { e.preventDefault(); select(next); }
  });
})();

/* Tool index — selecting a tool prints its one-line brief in the readout. */
(() => {
  const index = document.getElementById('tool-index');
  const note = document.getElementById('index-note');
  if (!index || !note) return;

  index.addEventListener('click', (e) => {
    const btn = e.target.closest('.index__btn');
    if (!btn) return;
    index.querySelectorAll('li.is-on').forEach((li) => li.classList.remove('is-on'));
    btn.closest('li')?.classList.add('is-on');
    note.innerHTML = '';
    const prompt = document.createElement('b');
    prompt.textContent = '>';
    const name = document.createElement('span');
    name.className = 'index__note-name';
    name.textContent = `${btn.textContent.trim()} `;
    const desc = document.createElement('span');
    desc.textContent = `— ${btn.dataset.note}`;
    note.append(prompt, ' ', name, desc);
  });
})();
