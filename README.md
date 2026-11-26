# PROJECT EXTREME++ — website

The official static site for **PROJECT EXTREME++ (BMW Edition)**, a custom Linux 4.19 kernel for the POCO F4 / Redmi K40S (`munch`).

Pure HTML, CSS and vanilla JavaScript. No framework, no bundler and no npm build step. GitHub Pages serves the files exactly as they are.

## What is included

- Dark and light themes with system-preference detection, a persisted toggle and a dark terminal/phone mockup in both modes
- Animated hero, canvas telemetry backdrop, glass panels, spotlight cards, tilt interactions and scroll reveals that sharpen from blur
- Live latest-release panel powered by the public GitHub API
- Smart download matcher for modded HyperOS / AOSP and KowSU + SuSFS / clean KernelSU / No Root
- Live changelog from GitHub releases, with verified static fallback entries
- Separate Telegram-style community at `community.html`: public General / Releases / Off-topic channels, server-validated message forwarding and a private Bug Hunting desk
- Google/GitHub sign-in for reviews and channel chat, with private bug reports visible only to their author and staff
- Public community profiles, report buttons, posting-only bans, configurable slow mode and an aggregate community pulse
- Compact floating liquid-glass dock with a spring lens indicator, scroll hide/reveal and an account-aware settings sheet
- Liquid Glass 2.0: animated ambient mesh, SVG edge refraction, global `glass-surface` / `glass-header` / `glass-pill` tiers and a readability pass for the community
- Noindex owner/admin console at `admin.html` for reports, content removal, bans, private bug reports, staff management, settings and the moderation audit log
- Privacy-first analytics: anonymous visitor IDs, daily server-side hashes and aggregate counts only — no IP addresses, emails or third-party trackers
- Graceful GitHub fallback: reviews and bug reports become prefilled issues, and chat points to Telegram / Discussions. GitHub has a prefilled-issue URL limit, so an unusually long bug report opens a shortened issue and copies the complete report to the clipboard for pasting
- Review wall merges on-site Supabase reviews, curated reviews and existing `[Review]` GitHub issues
- Installation tabs, verification commands, FAQ, Telegram support and a PWA offline shell
- Self-hosted fonts, app icons, a custom Open Graph image and a service worker

> Stock HyperOS is **not** supported. The kernel targets modded HyperOS builds, ColorOS ports and AOSP-based custom ROMs on Android 14–17.

## Deploy on GitHub Pages

1. Create a new **public** GitHub repository, for example `Extreme-plus-Web`.
2. Add these files to the repository root and push to the `main` branch.
3. In the repository, open **Settings → Pages → Build and deployment**.
4. Set **Source** to **GitHub Actions**.
5. The workflow in `.github/workflows/pages.yml` deploys automatically on every push to `main`.
6. Open the Pages URL shown by the workflow when it finishes.

All internal links are relative, so the site works at both:

- `https://<user>.github.io/` (user site)
- `https://<user>.github.io/<repo>/` (project site)

If your default branch is not `main`, update the branch name in `.github/workflows/pages.yml`.

### Local preview

```bash
cd extreme-kernel-site
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

The service worker registers only on HTTPS, so local HTTP previews never get a stale offline cache. If you test the service worker locally, use a tunnel or a local HTTPS server.

## Configuration

Edit `assets/js/config.js`:

```js
window.EXTREME_CONFIG = Object.freeze({
  siteUrl: "https://pandeyji-9.github.io/Extreme-plus-Web/",
  kernel: {
    owner: "PandeyJI-9",
    repo: "Extreme-PLUS-kernel-munch",
    fallbackBuild: "Build #133",
    releasesPerPage: 5
  },
  reviews: {
    owner: "PandeyJI-9",
    repo: "Extreme-PLUS-kernel-munch",
    titlePrefix: "[Review]",
    issuesPerPage: 50
  },
  community: {
    mode: "auto", // "auto" | "supabase" | "github"
    supabase: {
      url: "",
      anonKey: "",
      reviewsTable: "reviews",
      bugsTable: "bug_reports",
      chatTable: "chat_messages",
      chatPollMs: 8000,
      chatLimit: 50
    }
  }
  // …
});
```

The important options:

| Option | Meaning |
| --- | --- |
| `kernel.owner` / `kernel.repo` | Repository whose latest release drives downloads and changelog |
| `kernel.fallbackBuild` | Build label shown before the live API answers |
| `kernel.releasesPerPage` | Number of releases used by the changelog |
| `companion.fallbackDownload` | EKM APK fallback link if the APK is not attached to a release |
| `reviews.owner` / `reviews.repo` | Repository whose issues are merged into the review wall |
| `reviews.titlePrefix` | Only issues whose title starts with this prefix are treated as reviews |
| `community.mode` | `auto` uses Supabase when configured; `supabase` requests it but falls back safely if credentials are missing; `github` forces the fallback |
| `community.supabase.url` | Supabase project URL, for example `https://abcdefgh.supabase.co` |
| `community.supabase.anonKey` | Supabase anon key or publishable key. This value is public by design |
| `links.*` | Telegram, developer, GitHub and changelog links |
| `cacheMinutes` | Browser cache lifetime for GitHub API responses |
| `requestTimeoutMs` | Maximum wait before the site falls back to cached data |

## Community backend (Supabase)

The site talks to Supabase Auth and PostgREST directly. There is no runtime SDK, no server and no build step. If the URL and key are empty, the site stays in GitHub fallback mode.

### 1. Create the project

Create a free Supabase project, then open **SQL Editor** and run these files in order:

1. [`supabase/schema.sql`](supabase/schema.sql) — base tables, trusted author metadata, RLS and grants.
2. [`supabase/migrations/20261125_community_moderation.sql`](supabase/migrations/20261125_community_moderation.sql) — profiles, roles, reports, bans, audit log, slow-mode settings, public stats and owner analytics.
3. [`supabase/migrations/20261125_fix_track_visit_digest.sql`](supabase/migrations/20261125_fix_track_visit_digest.sql) — uses the `extensions.digest` function on hosted Supabase projects.
4. [`supabase/migrations/20261125_fix_admin_delete_audit.sql`](supabase/migrations/20261125_fix_admin_delete_audit.sql) — makes the admin-removal audit path DELETE-safe.
5. [`supabase/migrations/20261125_community_channels_forwarding.sql`](supabase/migrations/20261125_community_channels_forwarding.sql) — adds `chat_messages.channel`, forwarding metadata, the forwarding RPC, channel totals and the public member directory.
6. [`supabase/migrations/20261125_fix_fill_community_author_channels.sql`](supabase/migrations/20261125_fix_fill_community_author_channels.sql) — restores profile-backed author metadata while preserving channels and forwarding.

The migrations create:

- `public.community_profiles` — one public profile per auth user, with a unique case-insensitive username
- `public.community_admins` — owner/admin allowlist; the base table is upgraded with a `role` column
- `public.community_bans` — posting-only bans with optional expiry
- `public.community_reports` — private content reports and moderation state
- `public.community_moderation_log` — append-only audit trail
- `public.community_settings` — live rate limits and chat slow mode
- `public.site_visits` and `public.community_login_events` — privacy-preserving aggregate analytics
- `public.chat_messages` channel and forwarding columns — public channels are `general`, `releases` and `off-topic`; `bugs` is never a public chat channel
- RPCs for profiles, roles, heartbeat, visits, reports, bans, forwarding, public channel totals, public members, public stats and owner stats

Run the migration only once. It is written to be safe when applied to the base schema.

### 2. Enable Google and GitHub

In Supabase, open **Authentication → Providers** and enable the providers you want. The site ships with both Google and GitHub buttons; enable both, or remove the unused button from `index.html` if you only want one.

For each provider, add this callback URL to the provider’s OAuth app:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

- **Google:** create an OAuth client in Google Cloud Console. Use the Supabase callback URL as the authorized redirect URI.
- **GitHub:** create an OAuth App under GitHub Developer Settings. Use the Supabase callback URL as the authorization callback URL.

Supabase stores the provider client ID and secret; they never go into this site.

### 3. Allow the site URL

Open **Authentication → URL Configuration**:

```text
Site URL:
https://pandeyji-9.github.io/Extreme-plus-Web/

Redirect URLs:
https://pandeyji-9.github.io/Extreme-plus-Web/
http://localhost:8080/          # only needed for local testing
```

The exact production URL must be allowlisted. The site redirects back to the current directory, so both the trailing-slash Pages URL and the local preview URL work.

### 4. Connect the front end

Copy the **Project URL** and **anon/publishable key** from **Project Settings → API** into `assets/js/config.js`:

```js
community: {
  mode: "auto",
  supabase: {
    url: "https://<project-ref>.supabase.co",
    anonKey: "<anon-or-publishable-key>",
    // …
  }
}
```

**Never put a `service_role` key in the site.** The anon/publishable key is expected to be public; Row Level Security is the security boundary.

Local token files, `.env` files, private keys and credential JSON files are ignored by `.gitignore`. Do not commit a GitHub token or any Supabase secret. This site only needs the public anon/publishable key.

After redeploying, the header account button appears, the separate garage opens from the header/dock, the homepage shows a live channel preview, and reviews start using the on-site wall.

### 5. Assign the owner

The site deliberately does **not** auto-promote the first account. After deployment:

1. Sign in to the live site once with the GitHub account that should own the community.
2. Open the Supabase SQL Editor and inspect the account:

```sql
select u.id, u.email, u.created_at, p.username
from auth.users u
left join public.community_profiles p on p.user_id = u.id
order by u.created_at desc;
```

3. Assign the owner using the UUID from that result:

```sql
insert into public.community_admins (user_id, role, note)
values ('<auth-user-uuid>', 'owner', 'site owner')
on conflict (user_id) do update
set role = 'owner',
    note = excluded.note,
    updated_at = now();
```

Using the UUID avoids problems when the provider keeps the email private. Do not promote the first user automatically, and do not paste a `service_role` key into the site.

4. Open `admin.html`. The owner can add admins by username, change slow mode and limits, read private bug reports and view daily analytics. Admins can handle reports, remove content, ban members, read private bug reports and view the audit log.

Only the owner can add/remove admins or change settings. The owner account cannot be banned, the last owner cannot be removed, and admins cannot ban other admins.

### How the community behaves

| Feature | Signed out | Signed in | GitHub fallback |
| --- | --- | --- | --- |
| Reviews | Read only; prompted to sign in | Public review, instant publish | Prefilled GitHub issue |
| Bug hunting | Private desk; sign-in required | Only your own private reports, with a new-report form | Prefilled GitHub issue (public) |
| Public channels | Read only; sign-in gate | General / Releases / Off-topic chat, 6.5-second polling | Telegram / Discussions cards |
| Forwarding | — | Forward public messages between public channels | Not available |
| Reports | Sign-in required | Private report, limited per day | Not available |
| Account | Header sign-in button | Public profile, provider badge and sign-out | Hidden |
| Moderation | — | Owner/admin console at `admin.html` | — |

The Garage is a single mobile-first page with a desktop channel rail, mobile channel tabs and a members/rules drawer. `General`, `Releases` and `Off-topic` are public channels; `Bug Hunting` is a private, read-only support area that lists only the signed-in user's own reports and never accepts public messages. Staff read all private reports in `admin.html`.

Forwarding is server-owned. `community_forward_message` verifies that the source and target are public chat channels, then writes the original author/channel attribution in the same transaction. Client inserts cannot forge `forwarded_from_*` metadata.

Auth uses Supabase’s OAuth redirect flow. The access token is refreshed in the browser and the session is stored in `localStorage` under `extreme_plus_auth_v1`. The site never sees a password. OAuth callbacks must match a short-lived local sign-in state, so unsolicited tokens in a URL are rejected before a session is stored.

RLS rules:

- Public channels and reviews are publicly readable; inserts require `auth.uid() = user_id`. Channel writes are limited to `general`, `releases` and `off-topic`.
- Bug reports are readable only by their author or community staff. The `Bug Hunting` UI filters to the signed-in user's reports; staff use the admin console.
- Author names, usernames, avatars and providers come from `public.community_profiles`; timestamps, channels, bug status and forwarding attribution are set by triggers/RPCs, not trusted from the browser. New bug reports are forced to `open`.
- Reports are readable by the reporter and admins. Bans and the audit log are admin-only.
- Profile reads happen through the `community_get_profile` RPC; direct table reads are admin-only. The public member directory uses `community_public_members`, which never returns email addresses or user IDs.
- Posting bans block new reviews, chat messages, bug reports and reports. Banned members can still sign in and read.
- Authors can delete their own chat messages. Reviews, bug reports and other content are removed through the owner/admin console or the Supabase dashboard.

### Profiles, analytics and privacy

- Every auth user gets a unique username such as `rider_a1b2c3`. Usernames are 3–20 characters (`A-Z`, `a-z`, `0-9`, `_`), case-insensitive, and can be changed once every 30 days. Reserved names are blocked.
- Profiles show display name, bio, provider, join date, online state and the latest public reviews/chat. There are no avatar uploads; the site downsizes OAuth provider avatars and falls back to initials.
- Online means a profile heartbeat in the last 15 minutes. The page sends a heartbeat every 60 seconds while visible.
- Visits use a random `localStorage` visitor ID. The database stores a SHA-256 hash scoped to the current day, deduplicates the same path for 30 minutes, and never stores an IP address.
- Public stats show aggregate members, online now, visits, sign-ins, reviews, per-channel chat/message totals and public member cards. Daily/weekly detail and top paths are owner-only.
- The owner console is `noindex`; profile pages are `noindex` too because they contain user-generated content.
- New accounts are not blocked and there is no CAPTCHA. Abuse control is OAuth, server-side rate limits, reporting, posting bans and audit history.

### Change limits and slow mode

The owner can edit limits in **Admin → Settings**. Defaults are:

| Setting | Default |
| --- | --- |
| Chat slow mode | 5 seconds |
| Chat messages per hour | 40 |
| Reviews per 24 hours | 2 |
| Bug reports per 24 hours | 5 |
| Reports per 24 hours | 5 |

Limits are enforced by database triggers, so changing the front end cannot bypass them. Setting a daily limit to `0` blocks that action until the owner raises it again.

## How downloads are matched

The site requests the latest five releases, selects the newest non-draft, non-prerelease release, then matches attached `.zip` assets by filename:

| Choice | Filename tokens |
| --- | --- |
| HyperOS | `hyperos` |
| AOSP | `aosp` |
| KowSU + SuSFS | `susfs`, but **not** `nosusfs` |
| Clean KernelSU | `kow.su` / `kernelsu` / `ksu` / `resuki` without active SuSFS or `noroot` |
| No Root | `noroot` / `no-root` |

The EKM APK is resolved from an `.apk` asset whose filename starts with `ekm` in the same release. If GitHub is unavailable or rate-limited, the panel links directly to the releases page.

Keep variant filenames containing the ROM and root tokens above; otherwise a build will show “No exact match”. The matcher never falls back across ROM families.

## How reviews work

There are three review sources:

1. **Supabase reviews** — published instantly by signed-in users (primary path when configured).
2. **Curated reviews** — permanent entries in `assets/data/reviews.js`.
3. **GitHub issues** — existing public issues whose titles start with `[Review]`.

The wall merges them newest-first and de-duplicates by source URL and by author plus the first part of the review text. A **Refresh wall** button forces a fresh issue fetch, so a just-posted fallback review does not have to wait for the 15-minute cache. The GitHub path remains available as a fallback and preserves older reviews after the migration.

The GitHub issue body generated by the fallback composer looks like:

```md
### Review
Battery idle is excellent and the phone stays cool under Genshin.

### Rating
5 / 5

### ROM
Modded HyperOS

### Root flavor
KowSU + SuSFS

### Build tested
Build #133
```

GitHub’s unauthenticated API allows 60 requests per hour per IP. The site caches GitHub responses in `localStorage` for 15 minutes, and Supabase requests are not cached.

### Pinned reviews

Add a permanent review to `assets/data/reviews.js`:

```js
window.EXTREME_REVIEWS = [
  {
    name: "Rider",
    username: "rider",
    rating: 5,
    review: "Battery idle and thermals are exactly what I wanted.",
    rom: "Modded HyperOS",
    root: "KowSU + SuSFS",
    build: "Build #133",
    date: "2026-11-16",
    url: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/issues/1"
  }
];
```

Do not invent testimonials. Curated entries should be real, permissioned feedback or clearly labelled internal notes.

## Updating content for a new build

Most content updates itself from the GitHub release. Static HTML also contains fallback values for no-JavaScript visitors and search engines. When you cut a new build, update these if you want the fallback to stay current:

- `<strong data-latest-build>Build #133</strong>` and the release summary in `index.html`
- `kernel.fallbackBuild` in `assets/js/config.js`
- SoftwareApplication JSON-LD `softwareVersion`
- The fallback changelog entries (`FALLBACK_CHANGELOG`) in `assets/js/app.js`
- The static timeline in `#changelogList` (optional; live release notes replace it when the API answers)
- `assets/img/og-image.png` if the edition or headline changes

Release notes support lightweight Markdown-style lines. The changelog renderer turns headings, bullets and common emphasis into readable items; it is not a full Markdown engine.

## Service worker and caching

`sw.js` pre-caches the shell, fonts, icons, CSS and JS, including the community, profile and admin pages. Navigations are network-first with a per-URL cache and an offline fallback; static assets are stale-while-revalidate.

After deploying changes, **bump `SW_VERSION` in `sw.js`** (for example `v5` → `v6`). That changes the service worker file, triggers an update, and replaces the old cache on the next visit. Without a bump, returning visitors may keep using the old cached CSS/JS until the browser revalidates. The current release uses `v7`.

GitHub and Supabase API requests are cross-origin and intentionally never cached by the service worker. The app’s own GitHub `localStorage` cache is separate.

## Theme, motion and accessibility

- The theme is stored under `extreme_plus_theme`; with no stored value the site follows `prefers-color-scheme`.
- The inline head script sets the theme before the stylesheet loads to avoid a flash.
- `prefers-reduced-motion` disables the particle canvas, tilt, magnetic buttons and blur reveals.
- The terminal card and phone mockup deliberately remain dark in both themes for contrast and readability.
- Dialogs close with Escape or the backdrop, restore focus to their opener and trap focus natively through `<dialog>`.
- Forms use JavaScript validation because they set `novalidate`; review and bug drafts stay in `localStorage` on the current device until published through the site or cleared. In GitHub fallback mode the site cannot see when the prefilled issue is actually submitted, so fallback drafts stay available for reuse.

## Design system

- **Display type:** Anton
- **Body type:** Inter variable
- **Technical type:** JetBrains Mono variable
- **Palette:** carbon black, M-sport cyan `#3cdcff`, blue `#4678ff`, violet `#b06cff`, red `#ff3e63`
- **Effects:** glass panels, gradient text, scroll reveals, spotlight hover, hero tilt, particle canvas
- **Liquid glass:** layered specular rims, refraction gradients, blur and a pointer-follow dock highlight; CSS-only with reduced-motion/responsive fallbacks

All main tokens live at the top of `assets/css/style.css` under `:root` and `html[data-theme="light"]`. Fonts are self-hosted in `assets/fonts/`; there are no third-party UI libraries or tracking scripts. All three font families are licensed under the SIL Open Font License 1.1 — see `assets/fonts/LICENSE.txt`.

## File map

```text
.
├── index.html
├── community.html
├── profile.html
├── admin.html
├── site.webmanifest
├── sw.js
├── robots.txt
├── sitemap.xml
├── .nojekyll
├── .gitignore
├── .github/workflows/pages.yml
├── README.md
├── supabase
│   ├── schema.sql
│   └── migrations
│       ├── 20261125_community_moderation.sql
│       ├── 20261125_fix_track_visit_digest.sql
│       ├── 20261125_fix_admin_delete_audit.sql
│       ├── 20261125_community_channels_forwarding.sql
│       └── 20261125_fix_fill_community_author_channels.sql
└── assets
    ├── css
    │   ├── style.css
    │   ├── community.css
    │   ├── liquid-glass.css
    │   ├── glass-v2.css
    │   ├── profile.css
    │   └── admin.css
    ├── data/reviews.js
    ├── fonts/
    │   ├── anton-latin.woff2
    │   ├── inter-latin-variable.woff2
    │   ├── jetbrains-mono-latin-variable.woff2
    │   └── LICENSE.txt
    ├── img/
    │   ├── favicon.svg
    │   ├── app-icon-180.png
    │   ├── icon-192.png
    │   ├── icon-512.png
    │   ├── icon-512-maskable.png
    │   ├── noise.png
    │   └── og-image.png
    └── js
        ├── app.js
        ├── community-client.js
        ├── community.js
        ├── site-dock.js
        ├── profile.js
        ├── admin.js
        └── config.js
```

## Notes

- The GitHub API is public and unauthenticated. If rate-limited, the site shows cached data when possible and a direct releases link otherwise.
- Social previews use `assets/img/og-image.png`; the absolute URL in `index.html` must match the deployed Pages URL.
- The site is a front end for the kernel repository. Kernel source, releases, issues and the EKM app live in their own repositories.
- Supabase is optional. An unconfigured checkout still deploys as a complete GitHub-backed site.
