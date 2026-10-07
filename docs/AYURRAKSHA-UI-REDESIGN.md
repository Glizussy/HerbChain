# AyurRaksha public and authentication redesign

Implemented 6 October 2026. This iteration follows the attached scope: public entry screens and authentication. Detailed stakeholder dashboards and the authenticated farmer harvest form remain the next design phase.

## What changed

- Warm off-white, sage, natural green and restrained gold design system, botanical SVG artwork, large touch targets, responsive layouts and keyboard focus styles.
- New landing page with public scanning as the primary action, a four-step explanation, benefits, About and Contact sections.
- Visible English, Hindi, Marathi and Telugu selection on all new public/authentication screens. Language choice is saved locally. Translation strings are shared with native authentication.
- Public camera scanner with permission feedback, supported-device flash control, local image decoding and manual batch lookup. Uploaded QR images are decoded in the browser and are not sent to a storage service. Camera scanning requires HTTPS or localhost.
- Public herb page with names for known species, coarse source region, dates, a journey timeline, reported lab results, recall warnings and an optional technical summary.
- New email/password login, recovery request, eight friendly role cards and progressive registration. Role preference is saved as user metadata; it does not create an organization membership or Fabric signing identity.
- A one-use sign-in handoff to the existing permission-scoped workspace. The handoff is removed immediately on arrival; refresh/session handling remains in the workspace.
- Demo role selection and a sample herb journey that uses no real credentials and submits no transactions. This is a read-only sample experience, not a complete sandbox of each stakeholder's working dashboard. There is no invented Admin role.
- Native farmer authentication with multilingual sign-in, registration, demo sample, keyboard-aware layout and large controls. An access gate checks the server's participant role before opening farmer activities; other roles are directed to the web workspace.

## Routes

| URL | Screen |
| --- | --- |
| `/` | Landing page |
| `/scan` | Public QR scanner / image upload |
| `/trace?batch=YOUR_BATCH_ID` | Published product journey |
| `/login` | Participant login |
| `/signup` | Role selection and registration |
| `/demo` | Sample access by role |
| `/trace?demo=1` | Clearly labelled local sample journey |
| `/dashboard` | Existing participant workspace |

## Run it

Restart the existing API process to load the new routes; preserve the ledger, identities and evidence. From the existing Ubuntu environment, use your current launcher/account mapping, or the repository's launcher:

```bash
cd /mnt/c/Users/admin/HerbChain
node scripts/start-farmer-api.cjs --accounts /absolute/path/to/participant-accounts.json
```

Open `http://127.0.0.1:3002/`. To update the installed Android development app, reload it from Metro; these changes add no native dependencies. The API must be running and the current account mapped as a collector. See `SETUP-ANOTHER-DEVICE.md` for USB networking and native builds.

The Supabase project must allow the HTTPS `/reset-password` callback URL in its Auth redirect configuration. In native development, password recovery requires a reachable HTTPS API URL; a phone's localhost address is not a valid cross-device recovery callback. Existing Supabase email limits still apply. Mobile-number collection is optional contact information; SMS login is not implemented.

## Public information limits

The existing public API does not publish batch photographs, exact coordinates, farmer identity, plant-part details, medical descriptions, certification documents or individual transaction proofs. The page does not fabricate these. The image is a botanical illustration and is labelled as such for assistive technology. Missing plant-use/source details are shown as unavailable. A map is explained as unavailable because there is no public geographic route to map.

The badge says “Journey record available,” rather than implying that AyurRaksha independently certifies the physical herb or its safety. Timeline stages say “Recorded.” Reported laboratory outcomes and recall holds remain visible. Additional independent verification badges require an agreed evidence policy and corresponding backend fields.

New account preferences require administrator approval and enrollment. Automatic approval, notifications, an administrative approval inbox and a complete demo dashboard sandbox are not implemented by this UI change. Existing assigned permissions continue to come from the backend.

## Verification

- All 76 backend regression tests passed, including the new QR input checks.
- Browser checks passed on desktop, tablet and 390px mobile layouts, including all four language choices.
- Browser checks exercised progressive signup, sanitized recovery failures and password reset, login handoff to the existing workspace, demo isolation, public timelines/recall/error states, camera permission denial and decoding an actual QR image file.
- Native files passed Babel/JSX parsing. Real Android installation, on-device accessibility, camera/torch hardware and live Supabase/Fabric acceptance still need testing.
- Translation strings need fluent-speaker review before release. The full authenticated harvest form and existing stakeholder workflows are not yet translated by this scoped iteration.

## Main implementation files

`server/public/landing.html`, `scan.html`, `index.html`, `auth.html`, `ayur.css`, `ayur-i18n.js`, `ayur-translations.json`, `ayur-public.js`, `ayur-qr.js`, `ayur-auth.js`, `ayur-workspace-login.js`, `herb-illustration.svg`; `server/src/server.js`; `src/screens/AyurSignInScreen.js`; `src/components/AuthLanguage.js`, `FarmerAccessGate.js`; `App.js`.

The bundled jsQR decoder is distributed with its Apache-2.0 license in `server/public/vendor/`. Google Fonts are optional; system fonts remain as fallbacks.

## Signup without confirmation emails (2026-10-07)

Web and native registration first read the connected Supabase project's public Auth settings. `mailer_autoconfirm` must be true: in Authentication → Sign In / Providers → Email, disable **Confirm email** and save. Registration pauses before requesting signup when confirmation is still enabled or settings cannot be verified. When disabled, a returned signup session signs the user in automatically. Web users with approved memberships enter the dashboard; others see the account-created message and separate participant-approval requirement. Requested role metadata never grants access. Existing unconfirmed accounts may need an administrator to confirm them separately; this frontend change does not modify existing Auth users or project settings.
