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
    if (user?.identities?.length === 0) throw { uiKey:'accountAlreadyExists' };
    if (!user?.id) throw { uiKey:'authUnavailable' };
    return user;
  }
  function authError(error,status){
    if(error?.uiKey)return error.uiKey;
    const code=error?.code||error?.error_code;
    if(code==='invalid_credentials')return 'invalidCredentials';
    if(code==='email_not_confirmed')return 'existingAccountUnconfirmed';
    if(['user_already_exists','email_exists'].includes(code))return 'accountAlreadyExists';
    if(code==='weak_password')return 'weakPassword';
    if(code==='email_address_invalid'||code==='validation_failed')return 'invalidAuthInput';
    if(code==='email_address_not_authorized')return 'emailAddressRestricted';
    if(code==='signup_disabled')return 'signupDisabled';
    if(code==='captcha_failed')return 'captchaRequired';
    if(code==='email_confirmation_enabled')return 'emailConfirmationEnabled';
    if(status===429||['over_request_rate_limit','over_email_send_rate_limit'].includes(code))return 'authRateLimited';
    return 'authUnavailable';
  }
  return { requireNoEmailConfirmation, registrationSession, registrationUser,authError };
});
