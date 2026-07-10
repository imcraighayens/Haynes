"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Course, allLessons } from "@/lib/data";
import {
  loadProgress,
  markComplete,
  toggleComplete,
  touchCourse,
} from "@/lib/progress";

export default function Player({
  course,
  lessonId,
}: {
  course: Course;
  lessonId: string;
}) {
  const router = useRouter();
  const lessons = useMemo(() => allLessons(course), [course]);
  const index = lessons.findIndex((l) => l.id === lessonId);
  const lesson = lessons[index];
  const prev = lessons[index - 1];
  const next = lessons[index + 1];

  const [completed, setCompleted] = useState<string[]>([]);

  useEffect(() => {
    const sync = () =>
      setCompleted(loadProgress()[course.slug]?.completed ?? []);
    sync();
    touchCourse(course.slug, lessonId);
    window.addEventListener("kodelab-progress", sync);
    return () => window.removeEventListener("kodelab-progress", sync);
  }, [course.slug, lessonId]);

  const pct = Math.round((completed.length / lessons.length) * 100);
  const isDone = completed.includes(lessonId);

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-6 pb-24 pt-24 lg:grid-cols-[1fr_340px]">
      {/* Main */}
      <div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Link href="/courses" className="hover:text-white">
            Courses
          </Link>
          <span>/</span>
          <Link href={`/courses/${course.slug}`} className="hover:text-white">
            {course.title}
          </Link>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl bg-neutral-950 ring-1 ring-white/10">
          <video
            key={lesson.id}
            src={lesson.videoUrl}
            controls
            autoPlay
            playsInline
            className="aspect-video w-full bg-black"
            onEnded={() => {
              markComplete(course.slug, lesson.id);
              if (next)
                router.push(`/courses/${course.slug}/learn/${next.id}`);
            }}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-neutral-500">
              Lesson {index + 1} of {lessons.length} · {lesson.duration}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              {lesson.title}
            </h1>
          </div>
          <button
            onClick={() => toggleComplete(course.slug, lesson.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              isDone
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
                : "bg-white text-black hover:opacity-85"
            }`}
          >
            {isDone ? "✓ Completed" : "Mark as complete"}
          </button>
        </div>

        <div className="mt-8 flex items-center justify-between">
          {prev ? (
            <Link
              href={`/courses/${course.slug}/learn/${prev.id}`}
              className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-neutral-200 ring-1 ring-white/10 hover:bg-neutral-800"
            >
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/courses/${course.slug}/learn/${next.id}`}
              className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-neutral-200 ring-1 ring-white/10 hover:bg-neutral-800"
            >
              {next.title} →
            </Link>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="h-fit rounded-2xl border border-white/10 bg-neutral-950">
        <div className="border-b border-white/10 p-5">
          <h2 className="text-sm font-semibold text-white">{course.title}</h2>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {completed.length} of {lessons.length} lessons · {pct}% complete
          </p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {course.modules.map((mod) => (
            <div key={mod.title} className="mb-2">
              <p className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                {mod.title}
              </p>
              {mod.lessons.map((l) => {
                const active = l.id === lessonId;
                const done = completed.includes(l.id);
                return (
                  <Link
                    key={l.id}
                    href={`/courses/${course.slug}/learn/${l.id}`}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      active
                        ? "bg-white/10 text-white"
                        : "text-neutral-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                        done
                          ? "bg-emerald-500 text-black"
                          : "ring-1 ring-white/20"
                      }`}
                    >
                      {done ? "✓" : ""}
                    </span>
                    <span className="line-clamp-1">{l.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-neutral-600">
                      {l.duration}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
