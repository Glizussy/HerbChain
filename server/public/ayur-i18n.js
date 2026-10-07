/* Shared wording for the public website and native authentication. */
window.Ayur = {
  languages: ['en', 'hi', 'mr', 'te'], dictionary: {}, locale: 'en',
  t(key) { const entry = this.dictionary[key]; return entry ? entry[this.languages.indexOf(this.locale)] || entry[0] : key; },
  async init() {
    this.dictionary = await fetch('/ayur-translations.json').then(r => r.json());
    Object.assign(this.dictionary, await fetch('/workspace-translations.json').then(r => r.ok ? r.json() : {}).catch(() => ({})));
    try { this.locale = localStorage.getItem('ayur-language') || 'en'; } catch {}
    if (!this.languages.includes(this.locale)) this.locale = 'en';
    document.querySelectorAll('[data-language]').forEach(select => {
      select.value = this.locale;
      select.addEventListener('change', () => this.set(select.value));
    });
    this.apply();
  },
  set(locale) { if (!this.languages.includes(locale)) return; this.locale = locale; try { localStorage.setItem('ayur-language', locale); } catch {} this.apply(); window.dispatchEvent(new Event('ayur-language')); },
  apply() {
    document.documentElement.lang = this.locale;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.t(el.dataset.i18n); });
    document.querySelectorAll('[data-language]').forEach(el => { el.value = this.locale; });
  }
};
