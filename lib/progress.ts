"use client";

export type CourseProgress = {
  completed: string[];
  lastLessonId?: string;
  startedAt: number;
};

export type ProgressMap = Record<string, CourseProgress>;

const KEY = "kodelab-progress";

export function loadProgress(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as ProgressMap;
  } catch {
    return {};
  }
}

function save(map: ProgressMap) {
  window.localStorage.setItem(KEY, JSON.stringify(map));
  window.dispatchEvent(new Event("kodelab-progress"));
}

export function touchCourse(slug: string, lessonId: string) {
  const map = loadProgress();
  const entry = map[slug] ?? { completed: [], startedAt: Date.now() };
  entry.lastLessonId = lessonId;
  map[slug] = entry;
  save(map);
}

export function markComplete(slug: string, lessonId: string) {
  const map = loadProgress();
  const entry = map[slug] ?? { completed: [], startedAt: Date.now() };
  if (!entry.completed.includes(lessonId)) entry.completed.push(lessonId);
  entry.lastLessonId = lessonId;
  map[slug] = entry;
  save(map);
}

export function toggleComplete(slug: string, lessonId: string) {
  const map = loadProgress();
  const entry = map[slug] ?? { completed: [], startedAt: Date.now() };
  entry.completed = entry.completed.includes(lessonId)
    ? entry.completed.filter((id) => id !== lessonId)
    : [...entry.completed, lessonId];
  map[slug] = entry;
  save(map);
}

export function resetCourse(slug: string) {
  const map = loadProgress();
  delete map[slug];
  save(map);
}
