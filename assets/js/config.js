/**
 * EXTREME++ site configuration
 * ----------------------------
 * API, download and community settings live here. Change the repo names
 * below if you move the kernel or host the review issues separately.
 */
window.EXTREME_CONFIG = Object.freeze({
  siteUrl: "https://pandeyji-9.github.io/Extreme-plus-Web/",

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

  /**
   * Community backend
   * -----------------
   * "auto"     → use Supabase when a URL and anon key are present, otherwise
   *              fall back to GitHub issues and Discussions.
   * "supabase" → request the on-site Google/GitHub community. If the URL or
   *              key is missing, the site still falls back safely.
   * "github"   → force the zero-setup GitHub fallback.
   *
   * The anon key is designed to be public. Row Level Security in
   * supabase/schema.sql is what protects the data. Never paste a service_role
   * key into this file.
   */
  community: Object.freeze({
    mode: "auto",
    supabase: Object.freeze({
      url: "https://yudacdynrbvfromihwas.supabase.co",
      anonKey: "sb_publishable_Iok1VjBVuyTkpIDrExwd7Q_NvFLFz4M",
      reviewsTable: "reviews",
      bugsTable: "bug_reports",
      chatTable: "chat_messages",
      chatPollMs: 8000,
      chatLimit: 50
    }),
    discussions: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/discussions",
    bugTitlePrefix: "[Bug]"
  }),

  links: Object.freeze({
    telegram: "https://t.me/Extremeplus_Support",
    developer: "https://t.me/pandey_ji_8",
    kernelRepo: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch",
    kernelReleases: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/releases",
    kernelIssues: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/issues",
    discussions: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/discussions",
    changelogRaw: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/blob/main/EXTREME_Changelog.txt"
  }),

  // Public GitHub API cache lifetime. Keeps well inside the 60 requests/hour
  // unauthenticated limit for normal browsing and makes repeat visits instant.
  cacheMinutes: 15,
  requestTimeoutMs: 9000
});
