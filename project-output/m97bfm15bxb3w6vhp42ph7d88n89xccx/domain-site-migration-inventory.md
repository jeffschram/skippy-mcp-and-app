# Domain & Site Migration Inventory

Project: Migrate away from GoDaddy  
Project ID: m97bfm15bxb3w6vhp42ph7d88n89xccx  
Prepared: 2026-07-06  

## Status

This inventory is seeded from the domain list in the Skippy task and public DNS lookups run on 2026-07-06. It does not include private GoDaddy/Squarespace account fields such as renewal dates, auto-renew status, transfer lock state, auth codes, billing owner, or complete DNS zone exports. Those fields need to be verified inside the registrar/hosting dashboards before any cutover.

## Working Assumptions

- Domains using `ns1.mediatemple.net` / `ns2.mediatemple.net` are likely legacy MediaTemple/GoDaddy-managed DNS.
- Domains using `domaincontrol.com` nameservers are GoDaddy-managed DNS.
- Domains using Cloudflare nameservers are already on Cloudflare DNS.
- Vercel-hosted sites are visible through Vercel DNS targets such as `vercel-dns-017.com`.
- Squarespace-hosted sites are visible through `ext-sq.squarespace.com`, `ext-cust.squarespace.com`, or Squarespace IP ranges.
- GoDaddy/Microsoft-style legacy email is visible through `secureserver.net` MX/SPF records.

## Inventory Table

| Domain | Intended/current purpose from task | Visible DNS provider | Visible web target | Visible email/service records | Migration recommendation | Jeff must verify |
| --- | --- | --- | --- | --- | --- | --- |
| alloyradio.co | Not used | MediaTemple nameservers | Apex points to `76.223.67.189` / `13.248.213.45`; `www` aliases apex | No MX/TXT visible | Decide whether to keep. If keeping, move registrar/DNS to target platform and park/redirect intentionally. | Registrar, renewal cost/date, transfer lock, whether any hidden forwarding exists. |
| beerfest2.com | Not used | MediaTemple nameservers | Apex points to `13.248.213.45` / `76.223.67.189`; `www` aliases apex | No MX/TXT visible | Decide whether to keep. If keeping, move registrar/DNS and park/redirect intentionally. | Registrar, renewal cost/date, transfer lock, whether any hidden forwarding exists. |
| chefjeffcookies.com | Current Vercel app | GoDaddy DNS (`domaincontrol.com`) | Apex `216.198.79.1`; `www` CNAME to `4665ac78a1452a67.vercel-dns-017.com` | Google Workspace MX; Google site verification; SPF include | Keep site on Vercel. Move DNS to Cloudflare only after copying Google MX/TXT records exactly. | Vercel project owner, renewal date, current registrar, DKIM/DMARC records not visible in this quick lookup if on subdomains. |
| duckymoto.com | Current broken WordPress site | MediaTemple nameservers | Apex/www `107.180.2.192` | GoDaddy/SecureServer MX and SPF; TXT `D7384266` | Treat as rebuild candidate. Keep old hosting live while deciding whether to archive, redirect, or rebuild on Vercel. Preserve email if still used. | Whether WordPress content/files/db are needed; GoDaddy hosting plan; mailbox usage. |
| iamfranz.com | Current Vercel app | MediaTemple nameservers | Apex `216.198.79.1`; `www` CNAME to `4c8472be63ee88e8.vercel-dns-017.com` | No MX/TXT visible | Move DNS to Cloudflare and keep Vercel records. No email dependency visible. | Confirm no email/service records hidden in dashboard; Vercel project owner. |
| instaschram.com | URL forwarder | MediaTemple nameservers | Apex/www `107.180.2.192` | MX `mail.instaschram.com` | Replace with Vercel redirect project or Cloudflare redirect rule/page rule. Verify whether mailbox exists. | Forward destination, whether email is active, hosting dependency. |
| jeffjeffjeff.com | URL forwarder | MediaTemple nameservers | Apex/www `107.180.2.192` | GoDaddy/SecureServer MX/SPF; TXT `D9023792` | Replace with Vercel redirect project or Cloudflare redirect rule. Preserve email if active. | Forward destination, mailbox usage, TXT purpose. |
| jeffschram.com | Broken WordPress site | MediaTemple nameservers | Apex/www `107.180.2.192` | GoDaddy/SecureServer MX/SPF; TXT `D3534910` | High-priority rebuild/redirect candidate. If this should become primary personal site, point to Vercel after staging. Preserve email if active. | WordPress content/files/db; whether any email uses this domain; desired canonical relationship with `jeffschram.dev`. |
| jeffschram.dev | Current Vercel app | GoDaddy DNS (`domaincontrol.com`) | Apex `216.198.79.1`; `www` CNAME to `4bbf5ced23ad85a2.vercel-dns-017.com` | No MX/TXT visible | Keep on Vercel. Good pilot domain for DNS migration if email-free. | Registrar/expiry/transfer lock; Vercel project; whether any DNS records exist beyond public lookup. |
| moonbasecollective.com | URL forwarder | MediaTemple nameservers | Apex GoDaddy forwarding-ish IPs; `www` CNAME to `ext-cust.squarespace.com` | GoDaddy/SecureServer MX/SPF; TXT `D5774610` | Needs decision: it looks partially Squarespace plus legacy email. Do not cut over until purpose is clear. | Forward destination, Squarespace connection, email usage, whether this is still needed. |
| peopleareants.com | Not used | MediaTemple nameservers | Apex/www `107.180.2.192` | GoDaddy/SecureServer MX/SPF plus several verification TXT values | Decide whether to keep. TXT records suggest previous services; preserve only if identified. | What TXT records belong to; mailbox usage; whether domain can be dropped. |
| poopstats.com | Not used | MediaTemple nameservers | Apex/www `107.180.2.192` | GoDaddy/SecureServer MX/SPF; TXT `D8564923` | Decide whether to keep. If keeping, move and park/redirect. | Renewal cost/date, mailbox usage, TXT purpose. |
| schramburger.com | Current Vercel app | Cloudflare nameservers (`nick`, `annabel`) | Cloudflare-proxied A/AAAA; `www` resolves similarly | MX `mail.schramburger.com` | Already on Cloudflare DNS. Leave DNS in place; inspect registrar separately. | Registrar, whether `mail.schramburger.com` is active, Vercel target hidden behind Cloudflare. |
| schramindustries.com | Current Vercel app | MediaTemple nameservers | Apex `216.198.79.1`; `www` CNAME to `4bbf5ced23ad85a2.vercel-dns-017.com` | GoDaddy/SecureServer MX/SPF; TXT `D9977907` | Move to Cloudflare DNS after preserving email records. Keep Vercel target. | Email usage, registrar/expiry/transfer lock, TXT purpose. |
| soundsgoodtshirts.com | Used by Squarespace | MediaTemple nameservers | Apex Squarespace IPs; `www` CNAME to `ext-sq.squarespace.com` | MX `mail.soundsgoodtshirts.com` | Do not move until Squarespace replacement/export plan is ready. Can transfer registrar later while preserving DNS. | Squarespace site export/rebuild scope, ecommerce/shop requirements, mailbox usage, orders/products/customer data. |

## DNS Records Captured Publicly

```text
alloyradio.co
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A: 76.223.67.189; 13.248.213.45
www: CNAME alloyradio.co.; A 13.248.213.45; 76.223.67.189
MX: none visible
TXT: none visible

beerfest2.com
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A: 13.248.213.45; 76.223.67.189
www: CNAME beerfest2.com.; A 76.223.67.189; 13.248.213.45
MX: none visible
TXT: none visible

chefjeffcookies.com
NS: ns47.domaincontrol.com.; ns48.domaincontrol.com.
A: 216.198.79.1
www CNAME: 4665ac78a1452a67.vercel-dns-017.com.
MX: aspmx.l.google.com.; alt1.aspmx.l.google.com.; alt2.aspmx.l.google.com.; alt3.aspmx.l.google.com.; alt4.aspmx.l.google.com.
TXT: google-site-verification=sj6h04tvcXyucaKgJXVRFyEzpyPWdpDaOaaQ_HZB2_c; v=spf1 include:dc-aa8e722993._spfm.chefjeffcookies.com ~all

duckymoto.com
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A/www: 107.180.2.192
MX: smtp.secureserver.net.; mailstore1.secureserver.net.
TXT: v=spf1 include:secureserver.net -all; D7384266

iamfranz.com
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A: 216.198.79.1
www CNAME: 4c8472be63ee88e8.vercel-dns-017.com.
MX/TXT: none visible

instaschram.com
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A/www: 107.180.2.192
MX: mail.instaschram.com.
TXT: none visible

jeffjeffjeff.com
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A/www: 107.180.2.192
MX: smtp.secureserver.net.; mailstore1.secureserver.net.
TXT: v=spf1 include:secureserver.net -all; D9023792

jeffschram.com
NS: ns1.mediatemple.net.; ns2.mediatemple.net.
A/www: 107.180.2.192
MX: smtp.secureserver.net.; mailstore1.secureserver.net.
TXT: D3534910; v=spf1 include:secureserver.net -all

jeffschram.dev
NS: ns13.domaincontrol.com.; ns14.domaincontrol.com.
A: 216.198.79.1
www CNAME: 4bbf5ced23ad85a2.vercel-dns-017.com.
MX/TXT: none visible

moonbasecollective.com
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A: 3.33.251.168; 15.197.225.128
www CNAME: ext-cust.squarespace.com.
MX: mailstore1.secureserver.net.; smtp.secureserver.net.
TXT: v=spf1 include:secureserver.net -all; D5774610

peopleareants.com
NS: ns1.mediatemple.net.; ns2.mediatemple.net.
A/www: 107.180.2.192
MX: mailstore1.secureserver.net.; smtp.secureserver.net.
TXT: D9636836; v=spf1 include:secureserver.net -all; pk7hctkmjjdfvkj16to08kan9j; 13bpopuqbu6ubfldo5c2c3bqqo; notokenfound

poopstats.com
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A/www: 107.180.2.192
MX: smtp.secureserver.net.; mailstore1.secureserver.net.
TXT: D8564923; v=spf1 include:secureserver.net -all

schramburger.com
NS: nick.ns.cloudflare.com.; annabel.ns.cloudflare.com.
A: 104.21.73.39; 172.67.140.27
AAAA: 2606:4700:3036::ac43:8c1b; 2606:4700:3037::6815:4927
MX: mail.schramburger.com.

schramindustries.com
NS: ns2.mediatemple.net.; ns1.mediatemple.net.
A: 216.198.79.1
www CNAME: 4bbf5ced23ad85a2.vercel-dns-017.com.
MX: mailstore1.secureserver.net.; smtp.secureserver.net.
TXT: v=spf1 include:secureserver.net -all; D9977907

soundsgoodtshirts.com
NS: ns1.mediatemple.net.; ns2.mediatemple.net.
A: 198.185.159.144; 198.49.23.145; 198.185.159.145; 198.49.23.144
www CNAME: ext-sq.squarespace.com.
MX: mail.soundsgoodtshirts.com.
```

## Private Dashboard Checklist

For each domain in GoDaddy/Squarespace/current registrar:

- Current registrar
- Renewal/expiration date
- Auto-renew on/off
- Renewal price
- WHOIS/privacy status
- Domain protection level
- Transfer lock status
- DNSSEC/DS record status
- Authorization code available
- Current nameservers shown in dashboard
- Full DNS zone export or screenshot
- Email/mailbox product in use
- Forwarding settings in registrar UI
- Any products bundled with the domain

For each website:

- Current host/platform
- Source code/repo availability
- Content export path
- Forms, shop/ecommerce, memberships, analytics, custom scripts
- Redirects that must survive
- Domain aliases/canonical domain
- Required go-live checklist

## Sources

- Public DNS lookups run with `dig` on 2026-07-06.
- Vercel custom-domain docs: https://vercel.com/docs/domains/working-with-domains/add-a-domain
- Cloudflare Registrar docs: https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/
- GoDaddy transfer-away docs: https://www.godaddy.com/help/transfer-my-domain-away-from-godaddy-3560

