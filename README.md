# PROJECT EXTREME++ — website

The official static site for **PROJECT EXTREME++ (BMW Edition)**, a custom Linux 4.19 kernel for the POCO F4 / Redmi K40S (`munch`).

Pure HTML, CSS and vanilla JavaScript. No framework, no bundler and no npm build step. GitHub Pages serves the files exactly as they are.

## What is included

- Dark and light themes with system-preference detection, a persisted toggle and a dark terminal/phone mockup in both modes
- Animated hero, canvas telemetry backdrop, glass panels, spotlight cards, tilt interactions and scroll reveals that sharpen from blur
- Live latest-release panel powered by the public GitHub API
- Smart download matcher for modded HyperOS / AOSP and KowSU + SuSFS / clean KernelSU / No Root
- Live changelog from GitHub releases, with verified static fallback entries
- On-site community: Google/GitHub sign-in, public reviews, private bug reports and general chat
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

Create a free Supabase project, then open **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql). The file creates:

- `public.reviews` — public, signed-in reviews
- `public.bug_reports` — private reports visible to the author and community admins
- `public.chat_messages` — public, signed-in chat
- `public.community_admins` — optional on-site moderator allowlist
- RLS policies, trusted author metadata, basic rate limits and API grants

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

After redeploying, the header account button appears, the chat shell replaces the fallback, and reviews start using the on-site wall.

### 5. Optional: read bug reports on-site

The developer can always read every bug report through the Supabase dashboard because the dashboard uses a service role. To allow the signed-in developer account to read them through the API as well:

1. Sign in to the site once with the developer account.
2. Run this in the Supabase SQL editor, replacing the email:

```sql
insert into public.community_admins (user_id, note)
select id, 'developer'
from auth.users
where email = 'you@example.com'
on conflict (user_id) do nothing;
```

### How the community behaves

| Feature | Signed out | Signed in | GitHub fallback |
| --- | --- | --- | --- |
| Reviews | Read only; prompted to sign in | Public review, instant publish | Prefilled GitHub issue |
| Bug reports | No access; sign-in required to report | Private report to developer/admins | Prefilled GitHub issue (public) |
| General chat | Read only; sign-in gate | Public chat messages, 8-second polling | Telegram / Discussions cards |
| Account | Header sign-in button | Profile, provider badge and sign-out | Hidden |

Auth uses Supabase’s OAuth redirect flow. The access token is refreshed in the browser and the session is stored in `localStorage` under `extreme_plus_auth_v1`. The site never sees a password. OAuth callbacks must match a short-lived local sign-in state, so unsolicited tokens in a URL are rejected before a session is stored.

RLS rules:

- Reviews and chat are publicly readable; inserts require `auth.uid() = user_id`.
- Bug reports are readable only by their author or a community admin.
- Author names, avatars and providers come from `auth.users`; timestamps and new bug status are set by a trigger, not trusted from the browser. New bug reports are forced to `open`.
- Basic limits: 2 reviews per 24 hours, 5 bug reports per 24 hours, and one chat message every 5 seconds / 40 per hour.
- Users cannot update or delete rows from the browser. Moderate through the Supabase dashboard.

To change limits, edit `public.enforce_community_rate_limit()` in `supabase/schema.sql` and rerun that function definition. To moderate content, delete or hide rows in the Supabase table editor. If you want an on-site moderation UI later, add an admin-only policy and screen; the current site intentionally keeps moderation out of the public client.

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

`sw.js` pre-caches the shell, fonts, icons, CSS and JS. Navigations are network-first with an offline fallback; static assets are stale-while-revalidate.

After deploying changes, **bump `SW_VERSION` in `sw.js`** (for example `v3` → `v4`). That changes the service worker file, triggers an update, and replaces the old cache on the next visit. Without a bump, returning visitors may keep using the old cached CSS/JS until the browser revalidates.

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

All main tokens live at the top of `assets/css/style.css` under `:root` and `html[data-theme="light"]`. Fonts are self-hosted in `assets/fonts/`; there are no third-party UI libraries or tracking scripts. All three font families are licensed under the SIL Open Font License 1.1 — see `assets/fonts/LICENSE.txt`.

## File map

```text
.
├── index.html
├── site.webmanifest
├── sw.js
├── robots.txt
├── sitemap.xml
├── .nojekyll
├── .gitignore
├── .github/workflows/pages.yml
├── README.md
├── supabase
│   └── schema.sql
└── assets
    ├── css/style.css
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
        └── config.js
```

## Notes

- The GitHub API is public and unauthenticated. If rate-limited, the site shows cached data when possible and a direct releases link otherwise.
- Social previews use `assets/img/og-image.png`; the absolute URL in `index.html` must match the deployed Pages URL.
- The site is a front end for the kernel repository. Kernel source, releases, issues and the EKM app live in their own repositories.
- Supabase is optional. An unconfigured checkout still deploys as a complete GitHub-backed site.
