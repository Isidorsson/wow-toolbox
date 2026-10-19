/* WoW Toolbox · landing page
   Fetches the latest GitHub release and fills the download buttons, the
   release readout and the status pill. Fails quietly into a "view releases"
   fallback so the page works before any build has been published. The tool
   index prints the selected tool's one-line brief. The live changelog feed
   is its own script: changelog.js. */

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
    notesLink:      $('#release-notes-link'),
    downloadTag:    $('#download-tag'),
    downloadState:  $('#download-state'),
  };

  const formatSize = (bytes) => {
    if (!bytes || !Number.isFinite(bytes)) return 'n/a';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  };

  const formatDate = (iso) => {
    if (!iso) return 'n/a';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? 'n/a'
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

  // URLs from the API land in href attributes, so only https survives.
  const safeUrl = (url, fallback) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' ? parsed.href : fallback;
    } catch {
      return fallback;
    }
  };

  // Release facts show in the readout and the status pill: one name, many places.
  const setField = (name, value) => {
    document.querySelectorAll(`[data-field="${name}"]`).forEach((el) => {
      el.textContent = value;
    });
  };

  // CSS keys the release LEDs off this: absent while checking, then ready or none.
  const setReleaseState = (state) => {
    document.documentElement.dataset.release = state;
  };

  const showNoRelease = (reason) => {
    setReleaseState('none');
    if (ui.ctaVersion) ui.ctaVersion.textContent = 'no builds yet';
    if (ui.ctaDownload) {
      ui.ctaDownload.href = REPO_RELEASES;
      const label = ui.ctaDownload.querySelector('.btn__label');
      if (label) label.textContent = 'Watch repo';
    }
    if (ui.largeLabel)  ui.largeLabel.textContent  = 'View on GitHub';
    if (ui.largeDetail) ui.largeDetail.textContent = `github.com/${REPO}`;
    if (ui.largeCta)    ui.largeCta.href = REPO_RELEASES;
    if (ui.notesLink)   ui.notesLink.href = REPO_RELEASES;
    if (ui.downloadTag) {
      ui.downloadTag.textContent = reason
        ? `No build published yet · ${reason}`
        : 'No build published yet. Star the repo to get notified when the first release ships.';
    }
    if (ui.downloadState) ui.downloadState.textContent = 'No build yet';
    setField('version', 'pending');
    setField('size', 'n/a');
    setField('date', 'n/a');
  };

  const applyRelease = (rel) => {
    const asset   = pickAsset(rel.assets);
    const version = rel.tag_name || rel.name || 'latest';
    const size    = asset ? formatSize(asset.size) : 'n/a';
    const date    = formatDate(rel.published_at);
    const dlUrl   = safeUrl(asset?.browser_download_url || rel.html_url, REPO_RELEASES);
    const plat    = asset ? platformFromAsset(asset.name) : 'Win x64';

    setReleaseState('ready');

    if (ui.ctaVersion) ui.ctaVersion.textContent = `${version} · ${size}`;
    if (ui.ctaDownload) ui.ctaDownload.href = dlUrl;

    if (ui.largeLabel)  ui.largeLabel.textContent  = `Download ${version}`;
    if (ui.largeDetail) ui.largeDetail.textContent = size;
    if (ui.largeCta)    ui.largeCta.href = dlUrl;
    if (ui.notesLink)   ui.notesLink.href = safeUrl(rel.html_url, REPO_RELEASES);

    if (ui.downloadState) ui.downloadState.textContent = 'Ready';
    if (ui.downloadTag) {
      ui.downloadTag.textContent = asset
        ? `${asset.name} · published ${date}`
        : `Published ${date}`;
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
})();

/* Tool index: selecting a tool prints its one-line brief in the readout. */
(() => {
  const index = document.getElementById('tool-index');
  const note = document.getElementById('index-note');
  if (!index || !note) return;

  index.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.index__btn') : null;
    if (!btn) return;

    index.querySelectorAll('[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');

    const prompt = document.createElement('b');
    prompt.textContent = '>';
    prompt.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'index__note-name';
    name.textContent = btn.textContent.trim();
    const desc = document.createElement('span');
    desc.textContent = btn.dataset.note ?? '';
    note.replaceChildren(prompt, ' ', name, desc);
  });
})();
