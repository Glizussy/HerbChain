# Login and signup diagnostics

Website login/signup now use the same-origin `/api/auth/login`, `/api/auth/signup` and `/api/auth/settings` routes. The server calls its configured Supabase project over HTTPS with the public anon key. It does not use administrative credentials, confirm accounts behind Supabase's back, grant roles, store passwords or log request bodies. Automatic Fabric onboarding remains a separate authenticated step after login.

The proxy limits login/signup attempts to 20 per minute per directly connected IP, rejects cross-origin browser requests, bounds request bodies, and strips privileged signup fields. Signup rechecks the actual project's email confirmation setting before creating an account. In a production reverse-proxy deployment, establish trusted client-IP handling and provider rate limits deliberately; do not trust arbitrary forwarded headers.

Website and Android show distinct messages for provider-rejected credentials, unconfirmed old accounts, duplicate emails, password rules, disabled signup, CAPTCHA requirements, rate limits and network/service failures. Raw provider diagnostics are not displayed. See [Supabase's error-code reference](https://supabase.com/docs/guides/auth/debugging/error-codes).

## After updating

Restart the Ubuntu API, then hard-refresh the browser. Restart Metro and reload Android if using the phone. The old API process does not gain new routes until restarted.

If login still fails, read the new message:

- **Credentials rejected:** verify the exact account email or reset that account's password. Do not create a replacement account just to bypass the error.
- **Older account unconfirmed:** the administrator must confirm that existing account. Disabling confirmation for future signups is not an administrative update to older users.
- **Account already exists:** use login or password recovery.
- **Service unavailable:** check the API is updated and its Ubuntu process can reach Supabase; inspect the public `/api/auth/settings` response for connectivity.
- **Account setup could not finish:** authentication succeeded; troubleshoot the Fabric CA/onboarding rather than changing the password.
- **Access requested:** the account awaits role approval.

On 8 October 2026, read-only diagnostics verified that the running API pointed to the intended project, its public key matched the project environment, Supabase settings were reachable, email auto-confirmation was enabled and signups were not disabled. These checks do not establish successful authentication for a user's email/password. No user credentials were requested or used during testing.
