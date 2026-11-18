# BWORK Invoice Email — public information pages

Prepared 2026-11-05 from development commit `6803207bfa97cc5242c65f36902adfcb5600c5ad`.

## Files

- `booking-app/public/about.html`: service overview and direct policy links.
- `booking-app/public/privacy.html`: invoice email data use, Gmail send-only permission, providers, storage, audit history, retention criteria, data requests and revocation.
- `booking-app/public/terms.html`: document delivery scope, recipient accuracy, status meanings and support.
- `booking-app/public/bwork-info.css`: shared responsive styles, no external fonts/scripts.

These are draft disclosures for the operator to review before publication. Verify actual retention/deletion procedures, company details and that the support mailbox is monitored. No retention period, automatic deletion feature, Google approval or official e-Tax certification is claimed.

## State and scope

Source files only. No production/staging deployment, OAuth publishing, credentials changes, migration or Gmail/LINE dispatch was performed. The paused customer/tax RC remains unchanged. The development integration branch is not modified by this feature branch.

The public copy accurately says Gmail delivery is being prepared. Update that notice only when live sending has actually launched; OAuth publication alone does not launch it. Preserve `GMAIL_LIVE_DISPATCH_ENABLED=false` until dispatch is separately authorized.

## Deployment integration

Vite copies `public/` files to the Booking build root. Existing non-forced Pages SPA fallback rules should allow physical HTML/CSS assets to be served directly; verify this on the target host. Use explicit `.html` URLs, not invented React routes. No changes to the booking flow or API are necessary.

After merging this feature into the development branch, run the Booking build from `booking-app` (`npm.cmd run build` on Windows), and confirm these four files exist in `dist`. Do not deploy the entire development build to production while the customer/tax release is paused. When ready, prepare a reviewed selective release or a separate information-only static deployment.

For an isolated information site, copy **only these four files** into a clean upload directory. Do not upload repository roots, secrets, customer uploads, payment slips, PDFs or the existing `public/uploads` directory. For a dedicated site root, also copy `about.html` to `index.html` so its homepage is informative.

## Domain and Google Branding

Do not enter these paths as live URLs until deployed and checked. Do not invent a privacy URL or use `pages.dev` as though the company owns that shared parent domain. Select a company-controlled domain/subdomain and verify the applicable ownership with Google Search Console. Existing Pages hosting alone does not prove Google domain verification, and these pages do not guarantee OAuth approval.

Once actual HTTPS URLs exist on the verified site:

| Branding field | File on the chosen host |
| --- | --- |
| Application home page | `/about.html` (or `/` on an isolated site with index copy) |
| Application privacy policy link | `/privacy.html` |
| Application terms of service link | `/terms.html` |

Add the applicable registrable domain to Authorized domains as accepted by Google; do not paste a URL or path into that field. Check policy links on the homepage, then save Branding and inspect Audience / Verification Center. Google may require further checks.

Reference: https://support.google.com/cloud/answer/15549049?hl=en

## Validation

Local static validation checks HTML structure, local HTML/CSS link targets and HTTP 200 responses for all four public assets. No scripts or external asset dependencies are included. Chromium rendering was attempted but unavailable: the browser binary was missing and its download failed in this environment. Mobile layout uses a 680px CSS breakpoint, but real browser/mobile visual checks remain pending. These checks do not establish Cloudflare routing, Google verification or legal approval. Full app regression/build was not run for these isolated static additions.

Preview locally by serving `booking-app/public` with any static server and opening `/about.html`. This preview does not make the pages available to Google.
