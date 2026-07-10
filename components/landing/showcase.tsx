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
      { title: "Resume anywhere", body: "Pick a lesson back up mid-video on any device." },
      { title: "Set a weekly goal", body: "Choose your hours and Kodelab paces the modules." },
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
      { title: "10-minute lessons", body: "Each lesson covers exactly one idea, start to finish." },
      { title: "Real practitioners", body: "Learn from people who ship this work every day." },
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
      { title: "Follow-along builds", body: "Code and design alongside the instructor." },
      { title: "Portfolio-ready", body: "Ship a finished piece at the end of every course." },
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
      { title: "Skill placement", body: "A short assessment finds your starting module." },
      { title: "Track mapping", body: "Match courses you've done to Kodelab tracks." },
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
      { title: "Responsive player", body: "Full lesson experience at every screen size." },
      { title: "Progress that follows", body: "Start on your laptop, finish on your phone." },
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
      { title: "Course certificates", body: "Issued automatically at 100% completion." },
      { title: "Shareable badges", body: "Add track badges to your profile and CV." },
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
      { title: "Per-course completion", body: "Progress bars for everything you've started." },
      { title: "Weekly rhythm", body: "Watch-time and streaks that keep you moving." },
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
      { title: "Saved for later", body: "Queue up your next course in one click." },
      { title: "Clean archive", body: "Finished work moves out of your way, not out of reach." },
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
      { title: "Module checks", body: "A few sharp questions after every module." },
      { title: "Targeted rewatch", body: "Wrong answer? Jump straight to the relevant lesson." },
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
      { title: "Study groups", body: "Join a cohort working through the same track." },
      { title: "Mentor feedback", body: "Get your project reviewed by an instructor." },
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
      { title: "Career tracks", body: "Six paths from fundamentals to job-ready." },
      { title: "Next-step nudges", body: "Every completion suggests what to take next." },
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
          <div className="sticky top-[calc(50vh-190px)]">
            <div className="relative flex h-[380px] flex-col justify-end overflow-hidden rounded-[25px] bg-neutral-950 p-[30px]">
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

                <div className="rounded-2xl border border-hairline bg-[#0a0a0a] p-4 shadow-[0_-20px_60px_rgba(0,0,0,0.8)]">
                  <VideoCard
                    src={c.video}
                    title={`${c.title[0]} ${c.title[1]}`}
                    className="aspect-video"
                  />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {c.examples.map((ex) => (
                      <div
                        key={ex.title}
                        className="rounded-xl border border-hairline p-5 transition-colors hover:bg-white/[0.03]"
                      >
                        <p className="text-[13px] font-semibold text-white">{ex.title}</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
                          {ex.body}
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
