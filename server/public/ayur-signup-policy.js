/* Shared by the website and native signup. Project settings stay authoritative. */
(function(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.AyurSignupPolicy = policy;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  function requireNoEmailConfirmation(settings) {
    if (settings?.mailer_autoconfirm === false) throw { uiKey: 'emailConfirmationEnabled' };
    if (settings?.mailer_autoconfirm !== true) throw { uiKey: 'authSettingsUnavailable' };
  }
  function registrationSession(result) {
    const candidate = result?.session || result;
    return candidate?.access_token && candidate?.refresh_token ? candidate : null;
  }
  function registrationUser(result) {
    const user = result?.user || result?.session?.user || result;
    if (!user?.id || user.identities?.length === 0) throw { uiKey: 'signupError' };
    return user;
  }
  return { requireNoEmailConfirmation, registrationSession, registrationUser };
});
