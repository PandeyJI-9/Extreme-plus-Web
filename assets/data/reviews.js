/**
 * Curated, static reviews.
 * ------------------------
 * The live review wall pulls public GitHub issues whose titles start with
 * "[Review]". This file is here for reviews you want to pin manually.
 *
 * Each object supports:
 *   name      Display name
 *   username  GitHub username (used for the default avatar, optional)
 *   avatar    Absolute avatar image URL (optional)
 *   rating    Integer from 1 to 5
 *   review    The review text
 *   rom       "HyperOS" or "AOSP / Custom ROM"
 *   root      "KowSU + SuSFS" | "Clean KernelSU" | "No Root"
 *   build     e.g. "Build #133"
 *   date      ISO date string
 *   url       Link to the source, e.g. a GitHub issue or Telegram message
 *
 * Example:
 * window.EXTREME_REVIEWS = [
 *   {
 *     name: "Rider",
 *     username: "rider",
 *     rating: 5,
 *     review: "Battery idle and thermals are exactly what I wanted.",
 *     rom: "HyperOS",
 *     root: "KowSU + SuSFS",
 *     build: "Build #133",
 *     date: "2026-11-16",
 *     url: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/issues/1"
 *   }
 * ];
 */
window.EXTREME_REVIEWS = [];
