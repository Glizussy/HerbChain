(function (root) {
  function batchFromQR(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const text = value.trim();
    if (/^(HC-|LOT-|DEMO-)[A-Za-z0-9_-]{1,75}$/.test(text) && text.length <= 80) return text;
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/trace' || url.hash) return null;
      if (url.searchParams.getAll('batch').length !== 1) return null;
      const batch = url.searchParams.get('batch');
      return /^[A-Za-z0-9_-]{1,80}$/.test(batch || '') ? batch : null;
    } catch { return null; }
  }
  if (typeof module !== 'undefined') module.exports = { batchFromQR };
  else root.AyurQR = { batchFromQR };
})(typeof window === 'undefined' ? globalThis : window);
