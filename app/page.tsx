import Link from "next/link";
import VideoCard from "@/components/video-card";
import CourseCard from "@/components/course-card";
import { courses } from "@/lib/data";

const icon = {
  refresh: (
    <path d="M3 9a6 6 0 0 1 10.7-3.7M15 9A6 6 0 0 1 4.3 12.7M13.5 2.5v3h-3M4.5 15.5v-3h3" />
  ),
  image: (
    <>
      <rect x="2.5" y="2.5" width="13" height="13" rx="2" />
      <circle cx="6.5" cy="6.5" r="1.2" />
      <path d="M15 11.5l-3.5-3.5-7 7" />
    </>
  ),
  pencil: <path d="M3 15l.8-3.2L12.5 3l2.5 2.5-8.7 8.7L3 15zM11 4.5L13.5 7" />,
  arrow: <path d="M3 9h12M10.5 4.5L15 9l-4.5 4.5" />,
  expand: <path d="M11 3h4v4M7 15H3v-4M15 3l-5 5M3 15l5-5" />,
  cube: <path d="M9 2l6 3.5v7L9 16l-6-3.5v-7L9 2zM3 5.5l6 3.5 6-3.5M9 9v7" />,
  search: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M12 12l4 4" />
    </>
  ),
  database: (
    <>
      <ellipse cx="9" cy="4.5" rx="6" ry="2.5" />
      <path d="M3 4.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M3 9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
    </>
  ),
  check: (
    <>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M6 9.2l2 2 4-4.2" />
    </>
  ),
  spark: (
    <path d="M9 2v3M9 13v3M2 9h3M13 9h3M4.2 4.2l2 2M11.8 11.8l2 2M13.8 4.2l-2 2M6.2 11.8l-2 2" />
  ),
};

const features: { icon: keyof typeof icon; label: [string, string] }[] = [
  { icon: "refresh", label: ["Learn at", "your own pace"] },
  { icon: "image", label: ["Watch expert-led", "video lessons"] },
  { icon: "pencil", label: ["Build real projects", "from scratch"] },
  { icon: "arrow", label: ["Switch from", "another platform"] },
  { icon: "expand", label: ["Learn on", "any device"] },
  { icon: "cube", label: ["Earn certificates", "and badges"] },
  { icon: "search", label: ["Track progress and", "gain insights"] },
  { icon: "database", label: ["Manage your", "learning library"] },
  { icon: "check", label: ["Test and audit", "your skills"] },
  { icon: "spark", label: ["Connect with mentors", "and community"] },
];

const sections = [
  {
    id: "features",
    kicker: "Courses",
    title: "Expert-led lessons, structured like a real curriculum",
    body: "Every Kodelab course is built by working practitioners and broken into short, focused video lessons. Modules build on each other, so you always know what to watch next — no more piecing together random tutorials.",
    cta: { label: "Browse the catalog", href: "/courses" },
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  },
  {
    id: "projects",
    kicker: "Projects",
    title: "Build real projects while you watch",
    body: "Each module ends with a hands-on project that mirrors real work. Follow along in the player, mark lessons complete, and ship a portfolio piece by the end of every course.",
    cta: { label: "Start a course", href: "/courses" },
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  },
  {
    id: "community",
    kicker: "Progress",
    title: "Your progress, tracked automatically",
    body: "Kodelab remembers where you left off in every course. Resume with one click from your dashboard, see completion percentages per course, and keep your streak alive.",
    cta: { label: "Open my learning", href: "/dashboard" },
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  },
];

const stats = [
  { value: "120+", label: "hours of video" },
  { value: "6", label: "career tracks" },
  { value: "80k+", label: "learners" },
  { value: "4.8", label: "average rating" },
];

export default function Home() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-28 md:pt-36">
        <h1 className="rise rise-1 max-w-[1000px] text-[44px] font-semibold leading-[1.06] tracking-[-0.04em] text-white md:text-[68px]">
          Video courses for learning,
          <br className="hidden md:block" /> building, and mastering skills
        </h1>
        <div className="rise rise-2 mt-9 flex flex-wrap items-center gap-3">
          <Link
            href="/courses"
            className="rounded-full bg-white px-[18px] py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-85"
          >
            Get started for free
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-[#1a1a1a] px-[18px] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#262626]"
          >
            View my learning
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section className="rise rise-3 mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-hairline md:grid-cols-5">
          {features.map((f, i) => (
            <div
              key={f.label.join(" ")}
              className={`flex min-h-[148px] flex-col justify-between border-b border-r border-hairline p-6 transition-colors hover:bg-white/[0.03] ${
                i % 2 === 1 ? "border-r-0 md:border-r" : ""
              } ${(i + 1) % 5 === 0 ? "md:border-r-0" : ""} ${
                i >= features.length - 2 ? "border-b-0" : ""
              } ${i >= 5 ? "md:border-b-0" : "md:border-b"}`}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-neutral-300"
              >
                {icon[f.icon]}
              </svg>
              <p className="text-[13.5px] font-medium leading-[1.4] tracking-[-0.01em] text-neutral-100">
                {f.label[0]}
                <br />
                {f.label[1]}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Gradient card + video card */}
      <section className="mx-auto mt-24 grid max-w-6xl gap-6 px-6 md:grid-cols-[1fr_2fr]">
        <div className="relative flex min-h-[440px] flex-col justify-end overflow-hidden rounded-2xl bg-[radial-gradient(120%_120%_at_15%_0%,#a855f7_0%,#7c3aed_45%,#3b0f8f_100%)] p-8">
          <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <h2 className="relative text-[28px] font-semibold leading-tight tracking-[-0.02em] text-white">
            Learn at your
            <br />
            own pace
          </h2>
          <p className="relative mt-3 max-w-xs text-sm leading-relaxed text-white/75">
            Short lessons, hands-on projects, and progress that follows you —
            so your course fits your schedule, not the other way around.
          </p>
        </div>
        <VideoCard
          src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
          className="min-h-[440px]"
        />
      </section>

      {/* Stats */}
      <section className="mx-auto mt-24 max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-white/[0.08] md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-black p-8 text-center">
              <p className="text-4xl font-semibold tracking-[-0.03em] text-white [font-variant-numeric:tabular-nums]">
                {s.value}
              </p>
              <p className="mt-2 text-sm text-neutral-500">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Alternating feature sections */}
      {sections.map((s, i) => (
        <section
          key={s.id}
          id={s.id}
          className="mx-auto mt-28 grid max-w-6xl items-center gap-10 px-6 md:grid-cols-2"
        >
          <div className={i % 2 === 1 ? "md:order-2" : ""}>
            <p className="text-sm font-medium text-violet-400">{s.kicker}</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              {s.title}
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-neutral-400">
              {s.body}
            </p>
            <Link
              href={s.cta.href}
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white transition-opacity hover:opacity-75"
            >
              {s.cta.label}
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 9h12M10.5 4.5L15 9l-4.5 4.5" />
              </svg>
            </Link>
          </div>
          <VideoCard src={s.video} className={`aspect-video ${i % 2 === 1 ? "md:order-1" : ""}`} />
        </section>
      ))}

      {/* Popular courses */}
      <section id="resources" className="mx-auto mt-28 max-w-6xl px-6">
        <div className="flex items-end justify-between">
          <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Popular courses
          </h2>
          <Link
            href="/courses"
            className="text-sm text-neutral-400 transition-colors hover:text-white"
          >
            View all →
          </Link>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {courses.slice(0, 3).map((c) => (
            <CourseCard key={c.slug} course={c} />
          ))}
        </div>
      </section>

      {/* Testimonial */}
      <section className="mx-auto mt-28 max-w-4xl px-6 text-center">
        <p className="text-2xl font-medium leading-relaxed tracking-tight text-white md:text-3xl">
          “Kodelab is the first place where I actually finished the courses I
          started. The lessons are short, the projects are real, and the
          progress tracking keeps me honest.”
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-semibold text-black">
            LT
          </span>
          <div className="text-left">
            <p className="text-sm font-medium text-white">Lena Torres</p>
            <p className="text-xs text-neutral-500">Frontend Engineer, Datewell</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto my-28 max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-neutral-950 to-black px-8 py-20 text-center">
          <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/30 blur-3xl" />
          <h2 className="relative text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Start learning today
          </h2>
          <p className="relative mx-auto mt-4 max-w-md text-[15px] text-neutral-400">
            Join thousands of learners building real skills with Kodelab. Your
            first course is free.
          </p>
          <div className="relative mt-8 flex justify-center gap-3">
            <Link
              href="/courses"
              className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-85"
            >
              Get started for free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
