import Link from "next/link";
import Icon, { IconName } from "@/components/icons";
import CourseCard from "@/components/course-card";
import Showcase from "@/components/landing/showcase";
import Toolkit from "@/components/landing/toolkit";
import CtaPrompt from "@/components/landing/cta-prompt";
import { courses } from "@/lib/data";

const features: { icon: IconName; label: [string, string]; anchor: string }[] = [
  { icon: "refresh", label: ["Learn at", "your own pace"], anchor: "own-pace" },
  { icon: "image", label: ["Watch expert-led", "video lessons"], anchor: "expert-lessons" },
  { icon: "pencil", label: ["Build real projects", "from scratch"], anchor: "projects" },
  { icon: "arrow", label: ["Switch from", "another platform"], anchor: "switch" },
  { icon: "expand", label: ["Learn on", "any device"], anchor: "any-device" },
  { icon: "cube", label: ["Earn certificates", "and badges"], anchor: "certificates" },
  { icon: "search", label: ["Track progress and", "gain insights"], anchor: "insights" },
  { icon: "database", label: ["Manage your", "learning library"], anchor: "library" },
  { icon: "check", label: ["Test and audit", "your skills"], anchor: "skills-audit" },
  { icon: "spark", label: ["Connect with mentors", "and community"], anchor: "mentors" },
];

const everything: { icon: IconName; label: string; body: string; href: string }[] = [
  { icon: "image", label: "Video lessons", body: "Short, focused, expert-led.", href: "/courses" },
  { icon: "pencil", label: "Projects", body: "Portfolio work in every course.", href: "/#projects" },
  { icon: "search", label: "Progress", body: "Tracked across every device.", href: "/dashboard" },
  { icon: "cube", label: "Certificates", body: "Earned at 100% completion.", href: "/#certificates" },
  { icon: "spark", label: "Community", body: "Cohorts, mentors, showcase.", href: "/#mentors" },
  { icon: "database", label: "Library", body: "Save, queue, and archive.", href: "/#library" },
  { icon: "check", label: "Quizzes", body: "Module checks that stick.", href: "/#skills-audit" },
  { icon: "refresh", label: "Resume", body: "Pick up mid-lesson anytime.", href: "/dashboard" },
  { icon: "expand", label: "Any device", body: "Phone, tablet, or desktop.", href: "/#any-device" },
  { icon: "arrow", label: "Tracks", body: "Courses chained into careers.", href: "/courses" },
];

export default function Home() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-24 md:pt-32">
        <h1 className="rise rise-1 max-w-[820px] font-display text-[40px] font-medium leading-[1.0] tracking-[-0.04em] text-white md:text-[54px]">
          Video courses for learning,
          <br className="hidden md:block" /> building, and mastering skills
        </h1>
        <div className="rise rise-2 mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/courses"
            className="rounded-lg bg-white px-3.5 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-85"
          >
            Get started for free
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg bg-white/10 px-3.5 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/15"
          >
            View my learning
          </Link>
        </div>
      </section>

      {/* Bento category grid — the 10 categories the page scrolls through */}
      <section className="rise rise-3 mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-hairline md:grid-cols-5">
          {features.map((f, i) => (
            <a
              key={f.label.join(" ")}
              href={`#${f.anchor}`}
              className={`flex min-h-[148px] flex-col justify-between border-b border-r border-hairline p-6 transition-colors hover:bg-white/[0.03] ${
                i % 2 === 1 ? "border-r-0 md:border-r" : ""
              } ${(i + 1) % 5 === 0 ? "md:border-r-0" : ""} ${
                i >= features.length - 2 ? "border-b-0" : ""
              } ${i >= 5 ? "md:border-b-0" : "md:border-b"}`}
            >
              <Icon name={f.icon} size={20} strokeWidth={1.2} className="text-neutral-300" />
              <p className="text-[13px] font-semibold leading-[1.4] tracking-[-0.01em] text-white">
                {f.label[0]}
                <br />
                {f.label[1]}
              </p>
            </a>
          ))}
        </div>
      </section>

      {/* Sticky-scroll showcase — one section per category */}
      <Showcase />

      {/* Toolkit grid with animated mock-UIs */}
      <Toolkit />

      {/* Everything grid — dense, borderless */}
      <section id="resources" className="mx-auto mt-32 max-w-6xl scroll-mt-24 px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="max-w-xl font-display text-[34px] font-medium leading-[1.1] tracking-[-0.04em] text-white">
            Everything you need to learn, built into Kodelab
          </h2>
          <Link
            href="/courses"
            className="rounded-lg bg-white/10 px-3.5 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/15"
          >
            Browse all courses
          </Link>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-5">
          {everything.map((f) => (
            <Link key={f.label} href={f.href} className="group">
              <Icon name={f.icon} size={18} strokeWidth={1.3} className="text-neutral-300" />
              <p className="mt-4 text-[13px] font-semibold text-white group-hover:underline">
                {f.label}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
                {f.body}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Popular courses */}
      <section className="mx-auto mt-32 max-w-6xl px-6">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-[34px] font-medium leading-[1.1] tracking-[-0.04em] text-white">
            Popular courses
          </h2>
          <Link
            href="/courses"
            className="text-[13px] text-neutral-400 transition-colors hover:text-white"
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

      {/* Glowing prompt CTA */}
      <CtaPrompt />
    </div>
  );
}
