"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { allLessons, courses } from "@/lib/data";
import { ProgressMap, loadProgress, resetCourse } from "@/lib/progress";

export default function DashboardPage() {
  const [progress, setProgress] = useState<ProgressMap>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const sync = () => {
      setProgress(loadProgress());
      setLoaded(true);
    };
    sync();
    window.addEventListener("kodelab-progress", sync);
    return () => window.removeEventListener("kodelab-progress", sync);
  }, []);

  const started = courses.filter((c) => progress[c.slug]);

  return (
    <div className="mx-auto max-w-6xl px-6 pb-28 pt-32">
      <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
        My learning
      </h1>
      <p className="mt-3 text-[15px] text-neutral-400">
        Pick up right where you left off.
      </p>

      {loaded && started.length === 0 && (
        <div className="mt-16 rounded-2xl border border-white/10 bg-neutral-950 px-8 py-20 text-center">
          <p className="text-lg font-medium text-white">
            You haven&apos;t started any courses yet
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">
            Your progress will show up here once you start watching. Browse
            the catalog and dive in.
          </p>
          <Link
            href="/courses"
            className="mt-6 inline-block rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-85"
          >
            Explore courses
          </Link>
        </div>
      )}

      <div className="mt-10 space-y-4">
        {started.map((course) => {
          const entry = progress[course.slug];
          const lessons = allLessons(course);
          const pct = Math.round((entry.completed.length / lessons.length) * 100);
          const resumeId =
            entry.lastLessonId &&
            lessons.some((l) => l.id === entry.lastLessonId)
              ? entry.lastLessonId
              : lessons[0].id;
          return (
            <div
              key={course.slug}
              className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-neutral-950 p-6 md:flex-row md:items-center"
            >
              <div
                className={`h-20 w-full shrink-0 rounded-xl bg-gradient-to-br md:w-32 ${course.gradient}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-500">{course.category}</p>
                <h2 className="mt-0.5 truncate text-lg font-semibold text-white">
                  {course.title}
                </h2>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {pct === 100 ? "Completed 🎉" : `${pct}%`}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  href={`/courses/${course.slug}/learn/${resumeId}`}
                  className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition-opacity hover:opacity-85"
                >
                  {pct === 100 ? "Rewatch" : "Resume"}
                </Link>
                <button
                  onClick={() => resetCourse(course.slug)}
                  className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-neutral-400 ring-1 ring-white/10 transition-colors hover:text-white"
                >
                  Reset
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
