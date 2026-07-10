import Link from "next/link";
import { CustomCourse } from "@/lib/admin";

const gradients = [
  "from-violet-600 via-purple-500 to-indigo-700",
  "from-sky-500 via-cyan-400 to-blue-700",
  "from-fuchsia-600 via-pink-500 to-rose-600",
  "from-emerald-500 via-teal-400 to-cyan-600",
];

export default function CustomCourseCard({ course }: { course: CustomCourse }) {
  const gradient =
    gradients[
      Math.abs(
        [...course.slug].reduce((a, ch) => a + ch.charCodeAt(0), 0)
      ) % gradients.length
    ];

  return (
    <Link
      href={`/study/${course.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 transition-colors hover:border-white/25"
    >
      <div className={`relative h-40 bg-gradient-to-br ${gradient} p-5`}>
        <span className="absolute left-5 top-5 rounded-full bg-black/30 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          {course.category}
        </span>
        <span className="absolute right-5 top-5 rounded-full bg-black/30 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          Added by you
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-semibold text-white">{course.title}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-neutral-400">
          {course.tagline}
        </p>
        <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-neutral-500">
          <span>
            {course.lessons.length} lesson
            {course.lessons.length === 1 ? "" : "s"}
          </span>
          <span className="ml-auto rounded-full border border-white/10 px-2.5 py-0.5">
            Study
          </span>
        </div>
      </div>
    </Link>
  );
}
