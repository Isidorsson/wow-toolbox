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
      const label = ui.ctaDownload.querySelector('.cta__label');
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
})();
