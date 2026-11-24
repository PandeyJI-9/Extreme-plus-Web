/**
 * EXTREME++ site configuration
 * ----------------------------
 * Everything network-facing lives here. Change the repo names below if you
 * move the kernel or host the review issues in a separate repository.
 */
window.EXTREME_CONFIG = Object.freeze({
  kernel: Object.freeze({
    owner: "PandeyJI-9",
    repo: "Extreme-PLUS-kernel-munch",
    fallbackBuild: "Build #133",
    releasesPerPage: 5
  }),

  companion: Object.freeze({
    owner: "PandeyJI-9",
    repo: "extreme-kernel-manager",
    fallbackDownload: "https://github.com/PandeyJI-9/extreme-kernel-manager/releases/latest"
  }),

  reviews: Object.freeze({
    owner: "PandeyJI-9",
    repo: "Extreme-PLUS-kernel-munch",
    titlePrefix: "[Review]",
    issuesPerPage: 50
  }),

  links: Object.freeze({
    telegram: "https://t.me/Extremeplus_Support",
    developer: "https://t.me/pandey_ji_8",
    kernelRepo: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch",
    kernelReleases: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/releases",
    kernelIssues: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/issues",
    changelogRaw: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/blob/main/EXTREME_Changelog.txt"
  }),

  // Public GitHub API cache lifetime. Keeps well inside the 60 requests/hour
  // unauthenticated limit for normal browsing and makes repeat visits instant.
  cacheMinutes: 15,
  requestTimeoutMs: 9000
});
