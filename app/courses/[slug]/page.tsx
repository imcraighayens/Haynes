import Link from "next/link";
import { notFound } from "next/navigation";
import { allLessons, courses, getCourse, lessonCount } from "@/lib/data";

export function generateStaticParams() {
  return courses.map((c) => ({ slug: c.slug }));
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = getCourse(slug);
  if (!course) notFound();

  const firstLesson = allLessons(course)[0];

  return (
    <div className="pt-16">
      {/* Header */}
      <section className={`bg-gradient-to-br ${course.gradient}`}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-white/90">
            <span className="rounded-full bg-black/30 px-3 py-1 backdrop-blur">
              {course.category}
            </span>
            <span className="rounded-full bg-black/30 px-3 py-1 backdrop-blur">
              {course.level}
            </span>
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
            {course.title}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-white/85">{course.tagline}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href={`/courses/${course.slug}/learn/${firstLesson.id}`}
              className="rounded-full bg-white px-6 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-85"
            >
              Start course
            </Link>
            <div className="flex items-center gap-4 text-sm text-white/85">
              <span>★ {course.rating}</span>
              <span>{course.students.toLocaleString()} learners</span>
              <span>{lessonCount(course)} lessons</span>
              <span>{course.hours}h total</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-14 px-6 py-16 md:grid-cols-[2fr_1fr]">
        {/* Curriculum */}
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            About this course
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-neutral-400">
            {course.description}
          </p>

          <h2 className="mt-12 text-2xl font-semibold tracking-tight text-white">
            Curriculum
          </h2>
          <div className="mt-6 space-y-4">
            {course.modules.map((mod, mi) => (
              <div
                key={mod.title}
                className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950"
              >
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <h3 className="text-sm font-medium text-white">
                    <span className="mr-2 text-neutral-500">
                      {String(mi + 1).padStart(2, "0")}
                    </span>
                    {mod.title}
                  </h3>
                  <span className="text-xs text-neutral-500">
                    {mod.lessons.length} lessons
                  </span>
                </div>
                <ul>
                  {mod.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <Link
                        href={`/courses/${course.slug}/learn/${lesson.id}`}
                        className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.04]"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-900 ring-1 ring-white/10">
                          <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" className="text-neutral-300">
                            <path d="M6 4.5v11l9-5.5-9-5.5z" />
                          </svg>
                        </span>
                        <span className="text-sm text-neutral-200">{lesson.title}</span>
                        {lesson.preview && (
                          <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                            Free preview
                          </span>
                        )}
                        <span className="ml-auto text-xs text-neutral-500">
                          {lesson.duration}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-neutral-950 p-6">
            <h3 className="text-sm font-medium text-neutral-400">Instructor</h3>
            <div className="mt-4 flex items-center gap-3">
              <span
                className={`grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br ${course.gradient} text-sm font-semibold text-white`}
              >
                {course.instructor.initials}
              </span>
              <div>
                <p className="text-sm font-medium text-white">
                  {course.instructor.name}
                </p>
                <p className="text-xs text-neutral-500">{course.instructor.role}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-neutral-950 p-6">
            <h3 className="text-sm font-medium text-neutral-400">
              This course includes
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-neutral-300">
              <li>{course.hours} hours of on-demand video</li>
              <li>{lessonCount(course)} lessons in {course.modules.length} modules</li>
              <li>Hands-on projects</li>
              <li>Progress tracking</li>
              <li>Certificate of completion</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
