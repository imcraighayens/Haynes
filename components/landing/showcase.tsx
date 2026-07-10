"use client";

import { useEffect, useRef, useState } from "react";
import Icon, { IconName } from "@/components/icons";
import VideoCard from "@/components/video-card";

type Category = {
  id: string;
  icon: IconName;
  title: [string, string];
  description: string;
  video: string;
  /* [blob A, blob B] — one distinct hue per section, per the reference */
  hues: [string, string];
  examples: { title: string; body: string }[];
};

const v = (name: string) =>
  `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/${name}.mp4`;

const categories: Category[] = [
  {
    id: "own-pace",
    icon: "refresh",
    title: ["Learn at", "your own pace"],
    description:
      "Short lessons and flexible modules that fit around your life — Kodelab keeps your place so you can stop and start anytime.",
    video: v("BigBuckBunny"),
    hues: ["#a855f7", "#6d28d9"],
    examples: [
      { title: "Resume where I left off", body: "Pick a lesson back up mid-video on any device." },
      { title: "Set a weekly learning goal", body: "Choose your hours and Kodelab paces the modules for you." },
      { title: "Take a break without losing progress", body: "Your place is saved automatically, down to the second." },
    ],
  },
  {
    id: "expert-lessons",
    icon: "image",
    title: ["Watch expert-led", "video lessons"],
    description:
      "Every course is taught by a working practitioner and broken into focused, watchable lessons — no filler, no rambling.",
    video: v("Sintel"),
    hues: ["#4ade80", "#15803d"],
    examples: [
      { title: "Watch a 10-minute focused lesson", body: "Each lesson covers exactly one idea, start to finish." },
      { title: "Learn from real practitioners", body: "Every instructor ships this work professionally, every day." },
      { title: "Preview any course free", body: "The first lesson of every course is open to everyone." },
    ],
  },
  {
    id: "projects",
    icon: "pencil",
    title: ["Build real projects", "from scratch"],
    description:
      "Modules end in hands-on projects that mirror real work, so every course leaves you with something for your portfolio.",
    video: v("TearsOfSteel"),
    hues: ["#60a5fa", "#1d4ed8"],
    examples: [
      { title: "Build alongside the instructor", body: "Code and design in step with every lesson." },
      { title: "Ship a portfolio piece", body: "Finish every course with something real to show." },
      { title: "Compare against checkpoints", body: "Starter files include a checkpoint for every module." },
    ],
  },
  {
    id: "switch",
    icon: "arrow",
    title: ["Switch from", "another platform"],
    description:
      "Coming from Coursera, Udemy, or YouTube playlists? Bring your goals over and pick the track that matches where you left off.",
    video: v("ElephantsDream"),
    hues: ["#f472b6", "#be185d"],
    examples: [
      { title: "Take the skill placement", body: "A short assessment finds your exact starting module." },
      { title: "Map courses you've finished", body: "Match past learning to Kodelab tracks and skip ahead." },
      { title: "Bring your goals over", body: "Rebuild your learning plan here in a few minutes." },
    ],
  },
  {
    id: "any-device",
    icon: "expand",
    title: ["Learn on", "any device"],
    description:
      "The player, your notes, and your progress work the same on a phone on the train as they do on a desktop at your desk.",
    video: v("ForBiggerFun"),
    hues: ["#fb923c", "#c2410c"],
    examples: [
      { title: "Watch on any screen", body: "The full lesson experience at every screen size." },
      { title: "Start on desktop, finish on your phone", body: "Progress follows you across every device." },
      { title: "Learn on the commute", body: "Short lessons are built for in-between moments." },
    ],
  },
  {
    id: "certificates",
    icon: "cube",
    title: ["Earn certificates", "and badges"],
    description:
      "Finish a course and get a certificate of completion; finish a track and earn a badge you can share where it matters.",
    video: v("ForBiggerBlazes"),
    hues: ["#60a5fa", "#1e40af"],
    examples: [
      { title: "Earn a course certificate", body: "Issued automatically at 100% completion." },
      { title: "Collect track badges", body: "Finish a career track and earn a shareable badge." },
      { title: "Add credentials to your CV", body: "Every certificate has a public verification link." },
    ],
  },
  {
    id: "insights",
    icon: "search",
    title: ["Track progress and", "gain insights"],
    description:
      "See completion per course, watch-time per week, and streaks at a glance — your dashboard keeps you honest.",
    video: v("ForBiggerJoyrides"),
    hues: ["#a78bfa", "#5b21b6"],
    examples: [
      { title: "See per-course completion", body: "Progress bars for everything you've started." },
      { title: "Track your weekly rhythm", body: "Watch-time and streaks that keep you moving." },
      { title: "Know what to review next", body: "Kodelab flags the modules that need a second pass." },
    ],
  },
  {
    id: "library",
    icon: "database",
    title: ["Manage your", "learning library"],
    description:
      "Save courses for later, organize what you're working through now, and archive what you've finished — one tidy library.",
    video: v("ForBiggerEscapes"),
    hues: ["#34d399", "#065f46"],
    examples: [
      { title: "Save courses for later", body: "Queue up your next course in one click." },
      { title: "Organize what's in progress", body: "Your active courses stay front and center." },
      { title: "Archive finished work", body: "Out of your way, never out of reach." },
    ],
  },
  {
    id: "skills-audit",
    icon: "check",
    title: ["Test and audit", "your skills"],
    description:
      "Quick end-of-module checks confirm the lesson actually stuck — and show you exactly which lesson to rewatch when it didn't.",
    video: v("ForBiggerMeltdowns"),
    hues: ["#ec4899", "#9d174d"],
    examples: [
      { title: "Take a module check", body: "A few sharp questions after every module." },
      { title: "Jump straight to what you missed", body: "Wrong answer? Go directly to the relevant lesson." },
      { title: "Retake quizzes anytime", body: "Checks are for learning, not gatekeeping." },
    ],
  },
  {
    id: "mentors",
    icon: "spark",
    title: ["Connect with mentors", "and community"],
    description:
      "Study groups, mentor sessions, and a showcase for finished projects — learning sticks better when it isn't solitary.",
    video: v("WeAreGoingOnBullrun"),
    hues: ["#f97316", "#9a3412"],
    examples: [
      { title: "Join a study cohort", body: "Work through a track with people at your pace." },
      { title: "Book a mentor review", body: "Get your project reviewed by an instructor." },
      { title: "Post to the showcase", body: "Share finished projects with the community." },
    ],
  },
  {
    id: "keep-building",
    icon: "spark",
    title: ["Keep building", "after the course"],
    description:
      "Tracks chain courses together into a career path, so finishing one course always points you at a concrete next step.",
    video: v("SubaruOutbackOnStreetAndDirt"),
    hues: ["#fb923c", "#7c2d12"],
    examples: [
      { title: "Follow a career track", body: "Six paths from fundamentals to job-ready." },
      { title: "Get a next-step nudge", body: "Every completion suggests what to take next." },
      { title: "Chain courses into a path", body: "Each course sets up the one that follows." },
    ],
  },
];

export default function Showcase() {
  const [active, setActive] = useState(0);
  const blocksRef = useRef<(HTMLDivElement | null)[]>([]);

  /* Scroll-linked activation: the wrappers tile the scroll distance one
     viewport-height each, so the active section is the wrapper whose band
     contains the viewport center — exactly one at any scroll position. */
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = window.innerHeight / 2;
      let best = 0;
      blocksRef.current.forEach((el, i) => {
        if (!el) return;
        if (el.getBoundingClientRect().top <= mid) best = i;
      });
      setActive((prev) => (prev === best ? prev : best));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const cat = categories[active];

  return (
    <section className="mx-auto mt-28 max-w-6xl px-6">
      <div className="lg:grid lg:grid-cols-[44px_340px_1fr] lg:gap-8">
        {/* Scroll-spy icon rail — pinned at the vertical center of the viewport */}
        <div className="hidden lg:block">
          <div className="sticky top-[calc(50vh-216px)] flex flex-col gap-2">
            {categories.map((c, i) => (
              <button
                key={c.id}
                aria-label={c.title.join(" ")}
                onClick={() =>
                  blocksRef.current[i]?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  })
                }
                className={`grid h-9 w-9 place-items-center rounded-full border transition-colors duration-300 ${
                  i === active
                    ? "border-white bg-white text-black"
                    : "border-white/15 text-neutral-500 hover:border-white/40 hover:text-white"
                }`}
              >
                <Icon name={c.icon} size={15} strokeWidth={1.4} />
              </button>
            ))}
          </div>
        </div>

        {/* Pinned gradient blob card — vertically centered beside the content */}
        <div className="hidden lg:block">
          <div className="sticky top-[calc(50vh-180px)]">
            <div className="relative flex h-[360px] flex-col justify-end overflow-hidden rounded-[25px] bg-neutral-950 p-[30px]">
              <div
                className="blob-a pointer-events-none absolute -top-16 left-0 h-72 w-72 rounded-full blur-3xl transition-colors duration-500"
                style={{ backgroundColor: cat.hues[0], opacity: 0.85 }}
              />
              <div
                className="blob-b pointer-events-none absolute -right-10 bottom-0 h-80 w-80 rounded-full blur-3xl transition-colors duration-500"
                style={{ backgroundColor: cat.hues[1], opacity: 0.9 }}
              />
              <div key={cat.id} className="fade-swap relative">
                <h3 className="font-display text-[26px] font-medium leading-tight tracking-[-0.02em] text-white">
                  {cat.title[0]}
                  <br />
                  {cat.title[1]}
                </h3>
                <p className="mt-3 text-[13px] leading-relaxed text-white/80">
                  {cat.description}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Demo card deck — all cards are sticky siblings pinned to the same
            spot, so each one STAYS pinned while the next scrolls up and lands
            on top of it, like a deck of cards. The margin between cards sets
            the scroll distance per section; solid backgrounds do the occluding. */}
        <div className="space-y-24 lg:space-y-0 lg:pb-[25vh]">
          {categories.map((c, i) => (
            <div
              key={c.id}
              data-index={i}
              ref={(el) => {
                blocksRef.current[i] = el;
              }}
              className={`lg:sticky lg:top-[calc(50vh-310px)] ${
                i > 0 ? "lg:mt-[45vh]" : ""
              }`}
              style={{ zIndex: i + 1 }}
            >
              <div>
                {/* Mobile-only header (the pinned card mechanic is desktop-only) */}
                <div className="mb-5 lg:hidden">
                  <span
                    className="inline-grid h-9 w-9 place-items-center rounded-full text-white"
                    style={{ backgroundColor: c.hues[1] }}
                  >
                    <Icon name={c.icon} size={15} strokeWidth={1.4} />
                  </span>
                  <h3 className="mt-4 font-display text-2xl font-medium tracking-[-0.02em] text-white">
                    {c.title[0]} {c.title[1]}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                    {c.description}
                  </p>
                </div>

                <div
                  className={`rounded-[20px] border border-hairline bg-[#0a0a0a] p-4 shadow-[0_-20px_60px_rgba(0,0,0,0.8)] transition-[transform,opacity] duration-500 ease-out ${
                    i < active ? "lg:scale-[0.96] lg:opacity-60" : ""
                  }`}
                >
                  <VideoCard
                    src={c.video}
                    title={`${c.title[0]} ${c.title[1]}`}
                    className="aspect-video"
                  />
                  <div className="mt-4 flex flex-col gap-2">
                    {c.examples.map((ex) => (
                      <div
                        key={ex.title}
                        className="flex items-center gap-3 rounded-xl border border-hairline px-4 py-3 transition-colors hover:bg-white/[0.03]"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 text-neutral-400">
                          <Icon name="arrow" size={12} strokeWidth={1.5} />
                        </span>
                        <p className="min-w-0 text-[13px] leading-snug">
                          <span className="font-semibold text-white">{ex.title}</span>
                          <span className="text-neutral-500"> — {ex.body}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
