# Domain Migration Strategy & Cutover Plan

Project: Migrate away from GoDaddy  
Project ID: m97bfm15bxb3w6vhp42ph7d88n89xccx  
Prepared: 2026-07-06  

## Recommendation

Use Cloudflare DNS as the central DNS control plane for most or all domains.

For registrar choice:

1. Use Cloudflare Registrar for domains you are comfortable keeping on Cloudflare DNS long-term.
2. Use Porkbun as the flexible low-cost registrar for domains where you want registrar/DNS separation.

My default recommendation for this portfolio is:

- Move DNS to Cloudflare first, because that gives one consistent place to manage records, redirects, DNSSEC, and future Vercel cutovers.
- Transfer registrations in phases after DNS is stable.
- Use Cloudflare Registrar for simple domains that will stay on Cloudflare DNS.
- Use Porkbun for domains where you want less coupling between registrar and DNS, or if Cloudflare does not support a TLD/edge case.

Why not Vercel nameservers for everything? Vercel is excellent for app hosting, but this domain portfolio includes email, old forwarding, Squarespace, broken WordPress, and parked domains. A dedicated DNS layer gives better visibility and safer non-Vercel service preservation. Vercel should host the sites; Cloudflare should manage DNS.

## Key Constraints From Current Docs

- Vercel expects apex domains to use an A record, subdomains to use a CNAME record, and can also use nameservers. If changing nameservers for Vercel verification, any DNS records you want to preserve must be added to Vercel first.
- Cloudflare Registrar requires the domain to use Cloudflare as authoritative DNS. You cannot use another DNS provider while registered with Cloudflare.
- Cloudflare transfer prerequisites include: domain registered at least 60 days, not transferred in the last 60 days, no recent registrant contact change that triggered a 60-day lock, active registrar account, valid payment method, and domain active in Cloudflare first.
- GoDaddy transfer-away requires preparing the domain, unlocking it, turning off privacy/protection as needed, and obtaining the authorization code.
- ICANN transfer rules include auth-code requirements and common denial reasons such as transfer lock, initial registration within 60 days, previous transfer within 60 days, or payment/identity disputes.

## Suggested Domain Groups

### Group 1: Low-risk Vercel / no visible email

Good first migration candidates:

- `jeffschram.dev`
- `iamfranz.com`

These appear to be current Vercel apps and do not show public MX records. Still verify full DNS in the dashboard before cutover.

### Group 2: Vercel with email or legacy records

Do after Group 1:

- `chefjeffcookies.com`
- `schramindustries.com`

These already point web traffic to Vercel but have email/TXT records that must be preserved.

### Group 3: Broken WordPress / legacy hosting decisions

Plan content/rebuild before DNS cutover:

- `duckymoto.com`
- `jeffschram.com`

Keep current hosting alive until content/export decisions are done. If these become Vercel projects, stage and verify the Vercel deployments before switching DNS.

### Group 4: Forwarders / parked domains

Move when destinations are known:

- `alloyradio.co`
- `beerfest2.com`
- `instaschram.com`
- `jeffjeffjeff.com`
- `moonbasecollective.com`
- `peopleareants.com`
- `poopstats.com`

For each, decide: drop, park, redirect, or build. Replace GoDaddy forwarding with either Cloudflare redirect rules or a tiny Vercel redirect project.

### Group 5: Squarespace

Do last or as its own mini-project:

- `soundsgoodtshirts.com`

This is visibly Squarespace-backed. Do not move web DNS until products/shop/content/rebuild scope is clear.

### Already on Cloudflare

- `schramburger.com`

Leave DNS alone for now. Verify registrar and mail setup separately.

## Cutover Pattern

Repeat this per domain or per small batch.

### 1. Inventory and freeze

- Export or screenshot all DNS records from the current provider.
- Confirm email provider and active mailboxes.
- Confirm registrar, expiry date, auto-renew, protection/privacy, and transfer lock.
- Confirm DNSSEC/DS record status.
- Decide canonical destination: Vercel app, redirect, park page, or leave unchanged.

### 2. Lower TTL before switching

24-48 hours before DNS changes:

- Lower TTL on records that will change to 300 seconds where the current provider allows it.
- Do not change MX/email records unless you are intentionally migrating email.
- Do not disable existing hosting yet.

### 3. Stage destination

For Vercel-hosted domains:

- Add the domain to the correct Vercel project.
- Add both apex and `www` variants explicitly when needed.
- Follow Vercel's shown DNS instructions. Apex uses A record; subdomains use CNAME.
- Confirm Vercel verifies the domain before cutting production traffic when possible.
- Add redirects in the app or Vercel config for canonical host behavior.

For redirects:

- Prefer Cloudflare redirect rules if DNS is on Cloudflare.
- Use a tiny Vercel redirect project if the redirect needs code/config or should live with your Vercel setup.

For Squarespace replacement:

- Build/stage the Vercel replacement first.
- Export product/shop/content data where possible.
- Plan a separate ecommerce migration if checkout/order/customer data exists.

### 4. Move DNS to Cloudflare

- Add the domain as a Cloudflare zone.
- Let Cloudflare scan existing records, then manually compare against the exported DNS inventory. Do not trust auto-scan as complete.
- Add missing MX/TXT/CNAME/SRV/CAA records.
- Disable DNSSEC/DS records at the old provider before nameserver switch if DNSSEC is enabled.
- Change nameservers at current registrar to Cloudflare-assigned nameservers.
- Wait until Cloudflare marks the zone active.

### 5. Verify

Check:

- Apex URL
- `www` URL
- HTTPS certificate
- Canonical redirect direction
- Vercel domain status
- Email receive/send if any MX records exist
- SPF/DKIM/DMARC presence for email domains
- Analytics and forms
- Important old URLs

### 6. Transfer registrar later

Once DNS is stable:

- Unlock the domain.
- Disable privacy/protection if required by the source registrar.
- Request the auth/EPP code.
- Transfer to Cloudflare Registrar or Porkbun.
- Approve the transfer in the old registrar if offered.
- Keep old hosting active for 7-14 days after traffic migration.

## Rollback Plan

Before every cutover, save:

- Previous nameservers
- Full previous DNS record export
- Previous Vercel/Squarespace/GoDaddy target values
- Login/account recovery access for current registrar

If web breaks after DNS move:

1. Restore the previous A/CNAME records in Cloudflare if the issue is a bad target.
2. Revert nameservers at the registrar if the entire Cloudflare zone is wrong.
3. Keep old hosting active during the rollback window.

If email breaks:

1. Restore prior MX records.
2. Restore SPF/DKIM/DMARC TXT records.
3. Check whether Cloudflare proxy is accidentally enabled on mail-related hostnames. Mail hostnames should be DNS-only.

## Suggested First Concrete Run

Pilot with `jeffschram.dev`.

Why:

- It is a current Vercel app.
- It uses GoDaddy DNS.
- No public MX/TXT records were visible in the quick lookup, so email risk appears low.

Steps:

1. Verify in GoDaddy that no email/DKIM/DMARC/verification records exist beyond public lookup.
2. Add `jeffschram.dev` to Cloudflare.
3. Copy records:
   - Apex A: Vercel target shown by Vercel, currently public lookup shows `216.198.79.1`
   - `www` CNAME: Vercel target shown by Vercel, currently public lookup shows `4bbf5ced23ad85a2.vercel-dns-017.com`
4. Confirm DNSSEC is off at GoDaddy or remove DS records before nameserver switch.
5. Change nameservers at GoDaddy to Cloudflare.
6. Verify site, HTTPS, Vercel domain status, and redirects.
7. After 24-72 hours stable, decide whether to transfer registration to Cloudflare Registrar or Porkbun.

## Source Notes

- Cloudflare Registrar advertises at-cost registration/renewal, free DNS/CDN/SSL, WHOIS redaction, DNSSEC, and support for many common TLDs.
- Porkbun's public pricing page currently shows `.com from $11.08`, `.net from $12.52`, `.org from $7.98`, and `.dev first-year sale $8.75 / regular $12.87`.
- Cloudflare transfer docs say active work is about 30 minutes, total time can be up to 10 days, and most transfers include a one-year extension.
- GoDaddy says transfers typically take 5-7 days, and their flow exposes the auth code after transfer preparation.
- ICANN says registrars must provide auth codes within five calendar days when requested if not self-service.

Sources:

- https://www.cloudflare.com/products/registrar/
- https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/
- https://porkbun.com/products/domains
- https://vercel.com/docs/domains/working-with-domains/add-a-domain
- https://www.godaddy.com/help/transfer-my-domain-away-from-godaddy-3560
- https://www.icann.org/resources/pages/name-holder-faqs-2017-10-10-en

