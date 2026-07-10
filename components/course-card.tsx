import Link from "next/link";
import { Course, lessonCount } from "@/lib/data";

export default function CourseCard({ course }: { course: Course }) {
  return (
    <Link
      href={`/courses/${course.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 transition-colors hover:border-white/25"
    >
      <div
        className={`relative h-40 bg-gradient-to-br ${course.gradient} p-5`}
      >
        <span className="absolute left-5 top-5 rounded-full bg-black/30 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          {course.category}
        </span>
        <span className="absolute bottom-5 right-5 grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur transition-transform group-hover:scale-110">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6 4.5v11l9-5.5-9-5.5z" />
          </svg>
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-semibold text-white">{course.title}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-neutral-400">
          {course.tagline}
        </p>
        <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-neutral-500">
          <span className="flex items-center gap-1 text-amber-400">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
            </svg>
            {course.rating}
          </span>
          <span>{lessonCount(course)} lessons</span>
          <span>{course.hours}h</span>
          <span className="ml-auto rounded-full border border-white/10 px-2.5 py-0.5">
            {course.level}
          </span>
        </div>
      </div>
    </Link>
  );
}
