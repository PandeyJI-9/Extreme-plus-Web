/* ============================================================
   PROJECT EXTREME++ — offline shell
   Bump SW_VERSION whenever the site is redeployed so installed
   clients pick up the new CSS, JS and data files.
   ============================================================ */

const SW_VERSION = "v3";
const CACHE_NAME = `extreme-plus-static-${SW_VERSION}`;
const BASE_URL = new URL("./", self.location.href).href;
const INDEX_URL = new URL("index.html", BASE_URL).href;
const scopeUrl = (path) => new URL(path, BASE_URL).href;

const CORE_ASSETS = [
  "index.html",
  "assets/css/style.css",
  "assets/js/config.js",
  "assets/js/app.js",
  "assets/data/reviews.js",
  "assets/fonts/anton-latin.woff2",
  "assets/fonts/inter-latin-variable.woff2",
  "assets/fonts/jetbrains-mono-latin-variable.woff2",
  "assets/img/favicon.svg",
  "assets/img/app-icon-180.png",
  "assets/img/icon-192.png",
  "assets/img/icon-512.png",
  "assets/img/icon-512-maskable.png",
  "assets/img/noise.png",
  "site.webmanifest"
].map(scopeUrl);

const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline — PROJECT EXTREME++</title>
<style>
  :root { color-scheme: dark; }
  body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 2rem; background: #06070b; color: #f4f6fb; font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 34rem; }
  .brand { color: #3cdcff; font: 600 0.7rem/1 ui-monospace, monospace; letter-spacing: 0.18em; text-transform: uppercase; }
  h1 { margin: 1rem 0 0.75rem; font-size: clamp(2rem, 7vw, 3rem); line-height: 1.05; }
  p { color: #8c96a9; }
  a { display: inline-block; margin-top: 1.4rem; padding: 0.8rem 1.2rem; border-radius: 10px; background: #f4f6fb; color: #06070b; font-weight: 700; text-decoration: none; }
</style>
</head>
<body>
<main>
  <span class="brand">PROJECT EXTREME++</span>
  <h1>No signal in the pit lane.</h1>
  <p>This page was not cached yet and GitHub is unreachable. Reconnect and reload to see the latest live build, or open the GitHub releases page directly.</p>
  <a href="https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/releases/latest">Open GitHub releases</a>
</main>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // allSettled keeps a single missing optional asset from blocking install.
      await Promise.allSettled(
        CORE_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" })))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("extreme-plus-static-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // A cache write must never hide a fresh page from the user.
      await cache.put(INDEX_URL, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    return (
      (await cache.match(INDEX_URL, { ignoreVary: true })) ||
      (await cache.match(BASE_URL, { ignoreVary: true })) ||
      new Response(OFFLINE_PAGE, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      })
    );
  }
}

function isStaticAsset(request) {
  if (!["style", "script", "font", "image"].includes(request.destination)) {
    return false;
  }
  return new URL(request.url).origin === self.location.origin;
}

async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });

  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  return new Response("", {
    status: 504,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === new URL("sw.js", BASE_URL).pathname) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
