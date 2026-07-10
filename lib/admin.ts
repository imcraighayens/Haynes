"use client";

/**
 * Client-side admin/content store for Kodelab.
 *
 * SECURITY NOTE — READ BEFORE SHIPPING:
 * This app has no backend, so this "admin" area is a convenience console that
 * stores its data in the browser's localStorage on the current device only.
 * The passcode below is a LIGHT GATE to keep the panel out of the way — it is
 * NOT authentication and provides NO real security (the value ships in the
 * client bundle and anyone can read it). Before using this in production you
 * MUST replace it with real server-side auth (e.g. Supabase/Auth.js) and move
 * uploads/config to a real storage backend (e.g. object storage + a database).
 */

export const ADMIN_PASSCODE = "kodelab-admin";
const SESSION_KEY = "kodelab-admin-session";
const CONFIG_KEY = "kodelab-admin-config";

export type CustomLesson = {
  id: string;
  title: string;
  duration: string;
  videoUrl: string;
};

export type CustomCourse = {
  slug: string;
  title: string;
  tagline: string;
  category: string;
  lessons: CustomLesson[];
  createdAt: number;
};

export type AdminConfig = {
  /** Landing showcase video overrides, keyed by section id (see showcase.tsx). */
  showcaseVideos: Record<string, string>;
  /** Owner-added courses that appear in the catalog and study area. */
  customCourses: CustomCourse[];
};

const EMPTY: AdminConfig = { showcaseVideos: {}, customCourses: [] };

export function loadConfig(): AdminConfig {
  if (typeof window === "undefined") return EMPTY;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CONFIG_KEY) ?? "{}"
    ) as Partial<AdminConfig>;
    return {
      showcaseVideos: parsed.showcaseVideos ?? {},
      customCourses: parsed.customCourses ?? [],
    };
  } catch {
    return EMPTY;
  }
}

function save(config: AdminConfig) {
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event("kodelab-admin"));
}

export function setShowcaseVideo(sectionId: string, url: string) {
  const config = loadConfig();
  if (url.trim()) config.showcaseVideos[sectionId] = url.trim();
  else delete config.showcaseVideos[sectionId];
  save(config);
}

export function upsertCourse(course: CustomCourse) {
  const config = loadConfig();
  const i = config.customCourses.findIndex((c) => c.slug === course.slug);
  if (i >= 0) config.customCourses[i] = course;
  else config.customCourses.push(course);
  save(config);
}

export function deleteCourse(slug: string) {
  const config = loadConfig();
  config.customCourses = config.customCourses.filter((c) => c.slug !== slug);
  save(config);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* --- session gate (localStorage flag, not real auth) --- */

export function isUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(SESSION_KEY) === "1";
}

export function unlock(passcode: string): boolean {
  if (passcode === ADMIN_PASSCODE) {
    window.sessionStorage.setItem(SESSION_KEY, "1");
    return true;
  }
  return false;
}

export function lock() {
  window.sessionStorage.removeItem(SESSION_KEY);
}
