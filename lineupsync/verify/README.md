# LineupSync verification

Static GitHub Pages route: `https://cellohill.com/lineupsync/verify` (the directory URL may redirect to `/lineupsync/verify/`). Existing HTML pages, invite links, CNAME and email-confirmation landing page are unchanged.

## Configuration

Create a **Free, Managed** Cloudflare Turnstile widget. Allow `cellohill.com` and `www.cellohill.com`; keep pre-clearance disabled. Set only the public Site Key in `config.js`. An empty key makes app verification unavailable safely. Never put the Secret Key here, in mobile configuration, in URLs, or in chat. When enforcement is approved later, enter the Secret Key directly in Supabase's CAPTCHA dashboard settings.

No server, paid plan, proxy or new hosting service is needed. The existing root `CNAME` contains `www.cellohill.com`; verify both hosts' DNS, certificates and redirect behavior before enabling the app. This implementation never bypasses TLS validation. Both hosts must serve the same trusted route. If hosting is changed to send security headers, also send `Content-Security-Policy: frame-ancestors 'none'` (that directive cannot be enforced through an HTML meta tag).

## Native bridge contract (v1)

Load the real HTTPS URL in a React Native WebView. Before content loads, inject `window.__LINEUPSYNC_VERIFY__ = {version: 1, requestId: '<unique attempt id>'}`. IDs must contain 16–80 letters, numbers or hyphens and must contain no credentials. Also inject after load and call `window.LineupSyncStartVerification?.()` as an Android fallback; initialization is idempotent. Never pass configuration, credentials or tokens in the URL.

Messages go exclusively to `window.ReactNativeWebView.postMessage(JSON.stringify(...))`:

```json
{"source":"lineupsync-verify","version":1,"requestId":"verification-request-123456","type":"token","token":"<single-use-token>"}
```

Other types are `error`, `expired`, and `unavailable`, without tokens. Check the native event's exact HTTPS URL, source, version, current request ID and bounded token length. Accept once, acknowledge with `window.LineupSyncVerification?.acknowledge(requestId)`, close the WebView and immediately pass the token to Supabase Auth's `captchaToken` option. Never log, persist or reuse it. Every auth attempt, including a failed auth retry, needs a fresh verification. Delivery retries stop after five attempts; ACK stops retransmission. Expiry clears pending delivery and offers retry. Provider failures invalidate callbacks from the previous widget.

Only the two exact HTTPS origins and this path are trusted as top-level navigation. Allow `https://challenges.cloudflare.com`, `about:blank` and `about:srcdoc` only in subframes; block external top-level navigation and popups, file access, mixed content and OS link handoffs. Retain the default user agent, JavaScript and DOM storage. A normal website visit, browser iframe, or missing app handshake never loads Turnstile and never receives a token. No browser `window.postMessage`, parent, opener, redirect or custom-scheme token transport exists.

The handshake binds messages to an attempt; it is not native app attestation. Another app could reproduce the bridge. Security ultimately depends on Supabase validating the single-use token with Cloudflare after enforcement is enabled. Do not use the bridge as an authentication or authorization decision.

## Phased release

1. Review this PR, configure the public Site Key, and confirm GitHub Pages' publishing branch/root and whether merges auto-deploy. Publishing is a separate approved action; this branch is not deployed by this work.
2. Verify valid TLS on both hosts and `/lineupsync/verify` → trailing-slash/canonical redirects. Direct visits must show app guidance. Confirm existing invite and email-confirmation links still work.
3. Release the matching mobile integration with `EXPO_PUBLIC_AUTH_VERIFICATION_ENABLED` absent or `false`. Existing sessions and old clients continue unchanged. A native rebuild is required for the new WebView module.
4. Test an opted-in mobile build with `EXPO_PUBLIC_AUTH_VERIFICATION_ENABLED=true` while Supabase production CAPTCHA remains **disabled**. Validate the real Managed widget on iOS and Android, VoiceOver/TalkBack, larger text, light/dark appearance, cancel, offline/retry, expiry, stale messages and external navigation. Test auth with local Supabase and confirmed fixtures, never automated production emails.
5. Only after compatible clients are adopted and an old-client/minimum-version policy is agreed, separately approve enabling Supabase CAPTCHA with the Secret Key in the dashboard. Enabling it sooner breaks auth for old clients. Existing sessions must not be revoked. Roll back enforcement first if needed, then disable verification in a subsequent app build.

## Local verification

Run `node --test tests/verification.test.mjs` from the repository root. Tests execute the real script in an isolated VM with a simulated widget and bridge; no Cloudflare tokens, auth requests or emails are produced. A static local server can preview direct-visit layout. Do not weaken the production origin allowlist for local testing. Real device/provider validation is still required before opting in.

References: [Cloudflare mobile requirements](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/), [Free plan](https://developers.cloudflare.com/turnstile/plans/), [single-use token validation and expiry](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha).
