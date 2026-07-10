"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import VideoCard from "@/components/video-card";
import { CustomCourse, loadConfig } from "@/lib/admin";

export default function StudyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [course, setCourse] = useState<CustomCourse | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setCourse(loadConfig().customCourses.find((c) => c.slug === slug) ?? null);
      setReady(true);
    };
    sync();
    window.addEventListener("kodelab-admin", sync);
    return () => window.removeEventListener("kodelab-admin", sync);
  }, [slug]);

  const lessons = useMemo(() => course?.lessons ?? [], [course]);

  if (!ready) return <div className="pt-32" />;

  if (!course) {
    return (
      <div className="mx-auto max-w-3xl px-6 pb-28 pt-32 text-center">
        <h1 className="font-display text-3xl font-medium tracking-[-0.03em] text-white">
          Course not found
        </h1>
        <p className="mt-3 text-sm text-neutral-500">
          This course isn&apos;t available on this device. Courses added in the
          admin console are stored per-browser in this demo.
        </p>
        <Link
          href="/courses"
          className="mt-6 inline-block rounded-lg bg-white px-4 py-2.5 text-[12px] font-semibold text-black hover:opacity-85"
        >
          Back to courses
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 pb-28 pt-32">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <Link href="/courses" className="hover:text-white">
          Courses
        </Link>
        <span>/</span>
        <span className="text-neutral-400">{course.category}</span>
      </div>
      <h1 className="mt-4 font-display text-4xl font-medium tracking-[-0.04em] text-white md:text-5xl">
        {course.title}
      </h1>
      <p className="mt-3 max-w-xl text-[15px] text-neutral-400">{course.tagline}</p>
      <p className="mt-2 text-[13px] text-neutral-600">
        {lessons.length} lesson{lessons.length === 1 ? "" : "s"} · added in the
        admin console
      </p>

      <div className="mt-10 space-y-4">
        {lessons.map((lesson, i) => (
          <div
            key={lesson.id}
            className="rounded-2xl border border-hairline bg-neutral-950 p-4"
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <p className="text-[13px] font-semibold text-white">
                <span className="mr-2 text-neutral-600">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {lesson.title}
              </p>
              <span className="text-[12px] text-neutral-500">{lesson.duration}</span>
            </div>
            <VideoCard
              src={lesson.videoUrl}
              title={lesson.title}
              className="aspect-video rounded-xl"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
