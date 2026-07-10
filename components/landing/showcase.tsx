"use client";

import { useEffect, useRef, useState } from "react";
import Icon, { IconName } from "@/components/icons";
import VideoCard from "@/components/video-card";

type InfoCard = { title: string; rows: string[] };

type Category = {
  id: string;
  icon: IconName;
  title: [string, string];
  description: string;
  video: string;
  /* [light sweep, base] — one distinct hue pair per section */
  hues: [string, string];
  cards: InfoCard[];
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
    hues: ["#a855f7", "#3b0764"],
    cards: [
      {
        title: "Pacing controls",
        rows: [
          "Set a weekly goal of 3 hours and let Kodelab schedule your modules.",
          "Spread the remaining lessons of this course over two weeks.",
          "Resume exactly where you stopped yesterday, on any device.",
        ],
      },
      {
        title: "Flexible structure",
        rows: [
          "Skip ahead to the module you need now and come back later.",
          "Rewatch the last lesson at 0.75× speed with captions on.",
          "Mark a module as review-only so it doesn't block your progress.",
        ],
      },
    ],
  },
  {
    id: "expert-lessons",
    icon: "image",
    title: ["Watch expert-led", "video lessons"],
    description:
      "Every course is taught by a working practitioner and broken into focused, watchable lessons — no filler, no rambling.",
    video: v("Sintel"),
    hues: ["#4ade80", "#052e16"],
    cards: [
      {
        title: "Lesson quality",
        rows: [
          "See each instructor's background before you start their course.",
          "Preview the first lesson of every course in a track for free.",
          "Find courses taught by people shipping this work today.",
        ],
      },
      {
        title: "Focused format",
        rows: [
          "Queue only lessons under 12 minutes for your commute.",
          "One idea per video — check the outline before you press play.",
          "Watch a full module in under an hour, start to finish.",
        ],
      },
    ],
  },
  {
    id: "projects",
    icon: "pencil",
    title: ["Build real projects", "from scratch"],
    description:
      "Modules end in hands-on projects that mirror real work, so every course leaves you with something for your portfolio.",
    video: v("TearsOfSteel"),
    hues: ["#60a5fa", "#172554"],
    cards: [
      {
        title: "Guided builds",
        rows: [
          "Start the follow-along project for this module.",
          "Compare your work against the module's checkpoint files.",
          "See the finished project first, so you know where you're heading.",
        ],
      },
      {
        title: "Portfolio output",
        rows: [
          "Add your finished course project to your public profile.",
          "Export the project with a write-up for your portfolio.",
          "Request mentor feedback on your final build.",
        ],
      },
    ],
  },
  {
    id: "switch",
    icon: "arrow",
    title: ["Switch from", "another platform"],
    description:
      "Coming from Coursera, Udemy, or YouTube playlists? Bring your goals over and pick the track that matches where you left off.",
    video: v("ElephantsDream"),
    hues: ["#f472b6", "#500724"],
    cards: [
      {
        title: "Skill placement",
        rows: [
          "Take a short assessment and start at the right module.",
          "Skip everything you already know from past courses.",
          "Start at intermediate by showing what you've built before.",
        ],
      },
      {
        title: "Track mapping",
        rows: [
          "Map courses you've finished elsewhere to Kodelab tracks.",
          "Import your learning goals and get a weekly plan.",
          "See how Kodelab's approach to a topic differs before you commit.",
        ],
      },
    ],
  },
  {
    id: "any-device",
    icon: "expand",
    title: ["Learn on", "any device"],
    description:
      "The player, your notes, and your progress work the same on a phone on the train as they do on a desktop at your desk.",
    video: v("ForBiggerFun"),
    hues: ["#fb923c", "#431407"],
    cards: [
      {
        title: "Continuity",
        rows: [
          "Start a lesson on your laptop and finish it on your phone.",
          "Progress, captions, and speed settings sync automatically.",
          "Your library looks the same on every screen size.",
        ],
      },
      {
        title: "On the go",
        rows: [
          "Queue three short lessons for a train ride.",
          "Switch to audio-only while you're walking.",
          "Larger player controls kick in on small screens.",
        ],
      },
    ],
  },
  {
    id: "certificates",
    icon: "cube",
    title: ["Earn certificates", "and badges"],
    description:
      "Finish a course and get a certificate of completion; finish a track and earn a badge you can share where it matters.",
    video: v("ForBiggerBlazes"),
    hues: ["#60a5fa", "#1e1b4b"],
    cards: [
      {
        title: "Certificates",
        rows: [
          "Certificates are issued automatically at 100% completion.",
          "Every certificate carries a public verification link.",
          "Reissue a certificate after updating your display name.",
        ],
      },
      {
        title: "Badges",
        rows: [
          "See the badge you'll earn for finishing each career track.",
          "Pin track badges to your public Kodelab profile.",
          "Share a badge announcement straight to your network.",
        ],
      },
    ],
  },
  {
    id: "insights",
    icon: "search",
    title: ["Track progress and", "gain insights"],
    description:
      "See completion per course, watch-time per week, and streaks at a glance — your dashboard keeps you honest.",
    video: v("ForBiggerJoyrides"),
    hues: ["#a78bfa", "#2e1065"],
    cards: [
      {
        title: "Progress",
        rows: [
          "Completion bars for every course you've started.",
          "See which module to review before the next quiz.",
          "Weekly watch-time totals, split by track.",
        ],
      },
      {
        title: "Momentum",
        rows: [
          "Keep a streak alive with the shortest lesson left today.",
          "Set a weekday evening reminder to continue.",
          "Compare this month's learning time to last month's.",
        ],
      },
    ],
  },
  {
    id: "library",
    icon: "database",
    title: ["Manage your", "learning library"],
    description:
      "Save courses for later, organize what you're working through now, and archive what you've finished — one tidy library.",
    video: v("ForBiggerEscapes"),
    hues: ["#34d399", "#022c22"],
    cards: [
      {
        title: "Organize",
        rows: [
          "Save a course for later and queue the next one.",
          "Pin active courses to the top of your library.",
          "Archive everything you finished last year in one sweep.",
        ],
      },
      {
        title: "Curate",
        rows: [
          "Build a playlist of lessons on a single topic.",
          "Share a saved list with your study group.",
          "Duplicate a track's outline as your own custom path.",
        ],
      },
    ],
  },
  {
    id: "skills-audit",
    icon: "check",
    title: ["Test and audit", "your skills"],
    description:
      "Quick end-of-module checks confirm the lesson actually stuck — and show you exactly which lesson to rewatch when it didn't.",
    video: v("ForBiggerMeltdowns"),
    hues: ["#ec4899", "#500724"],
    cards: [
      {
        title: "Module checks",
        rows: [
          "A few sharp questions after every module.",
          "Wrong answers link straight to the lesson to rewatch.",
          "Retake any check — they're for learning, not gatekeeping.",
        ],
      },
      {
        title: "Skill audits",
        rows: [
          "Run a full audit of your skills across a track.",
          "See the gaps between you and the job-ready bar.",
          "Turn audit results into a review plan automatically.",
        ],
      },
    ],
  },
  {
    id: "mentors",
    icon: "spark",
    title: ["Connect with mentors", "and community"],
    description:
      "Study groups, mentor sessions, and a showcase for finished projects — learning sticks better when it isn't solitary.",
    video: v("WeAreGoingOnBullrun"),
    hues: ["#f97316", "#431407"],
    cards: [
      {
        title: "Community",
        rows: [
          "Join a cohort working through the same track this month.",
          "Post your final project to the community showcase.",
          "Find a study partner in your timezone.",
        ],
      },
      {
        title: "Mentorship",
        rows: [
          "Book a 30-minute project review with an instructor.",
          "Ask a mentor whether your portfolio is job-ready.",
          "Get a module project critiqued by the community.",
        ],
      },
    ],
  },
  {
    id: "keep-building",
    icon: "spark",
    title: ["Keep building", "after the course"],
    description:
      "Tracks chain courses together into a career path, so finishing one course always points you at a concrete next step.",
    video: v("SubaruOutbackOnStreetAndDirt"),
    hues: ["#fb923c", "#3b0764"],
    cards: [
      {
        title: "Career tracks",
        rows: [
          "See the full path from fundamentals to job-ready.",
          "Know exactly which course comes next in your track.",
          "Estimate how long the rest of your track will take.",
        ],
      },
      {
        title: "Next steps",
        rows: [
          "Get a next-course suggestion the moment you finish.",
          "Chain finished courses into a custom path.",
          "Set a target date for completing your track.",
        ],
      },
    ],
  },
];

/* Small copy-style glyph used on each example row, as in the reference */
function RowGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className="shrink-0 text-neutral-600"
      aria-hidden
    >
      <rect x="6" y="6" width="9" height="9" rx="2" />
      <path d="M12 6V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v6A1.5 1.5 0 0 0 4.5 12H6" />
    </svg>
  );
}

const PIN = "lg:sticky lg:top-[84px]";

export default function Showcase() {
  const [active, setActive] = useState(0);
  const [railVisible, setRailVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const blocksRef = useRef<(HTMLDivElement | null)[]>([]);

  /* Scroll-linked: the active section is the last one whose top has crossed
     the viewport center; the rail shows only while the showcase is on screen. */
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
      const s = sectionRef.current?.getBoundingClientRect();
      setRailVisible(!!s && s.top < mid && s.bottom > mid);
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

  return (
    <section ref={sectionRef} className="mx-auto mt-28 max-w-6xl px-6">
      {/* Scroll-spy icon rail — floats just outside the container's left edge */}
      <div
        className={`fixed top-[96px] z-40 hidden flex-col gap-1.5 transition-opacity duration-300 xl:flex ${
          railVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ left: "max(8px, calc(50vw - 618px))" }}
      >
        {categories.map((c, i) => (
          <button
            key={c.id}
            aria-label={c.title.join(" ")}
            onClick={() =>
              blocksRef.current[i]?.scrollIntoView({ behavior: "smooth" })
            }
            className={`grid h-8 w-8 place-items-center rounded-full border transition-colors duration-300 ${
              i === active
                ? "border-white bg-white text-black"
                : "border-white/15 bg-black/40 text-neutral-500 hover:border-white/40 hover:text-white"
            }`}
          >
            <Icon name={c.icon} size={13} strokeWidth={1.4} />
          </button>
        ))}
      </div>

      <div className="space-y-24 lg:space-y-6">
        {categories.map((c, i) => (
          <div
            key={c.id}
            data-index={i}
            ref={(el) => {
              blocksRef.current[i] = el;
            }}
            className="lg:grid lg:grid-cols-[390px_1fr] lg:items-start lg:gap-4"
          >
            {/* Section blob card — pins while its section's cards stack */}
            <div className={`hidden lg:block ${PIN}`}>
              <div
                className="relative flex h-[475px] flex-col justify-end overflow-hidden rounded-[25px] p-[30px]"
                style={{ backgroundColor: c.hues[1] }}
              >
                <div
                  className="blob-a pointer-events-none absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full blur-3xl"
                  style={{ backgroundColor: c.hues[0], opacity: 0.75 }}
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                <div className="relative">
                  <h3 className="font-display text-[28px] font-medium leading-tight tracking-[-0.02em] text-white">
                    {c.title[0]}
                    <br />
                    {c.title[1]}
                  </h3>
                  <p className="mt-3 max-w-[280px] text-[13px] leading-relaxed text-white/75">
                    {c.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Right column — video and info cards, each pinning in turn so
                the next slides up and covers it */}
            <div className="flex flex-col gap-4">
              {/* Mobile-only header */}
              <div className="lg:hidden">
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

              <div className={PIN} style={{ zIndex: 1 }}>
                <VideoCard
                  src={c.video}
                  title={`${c.title[0]} ${c.title[1]}`}
                  className="aspect-video rounded-[20px] shadow-[0_-16px_48px_rgba(0,0,0,0.85)]"
                />
              </div>

              {c.cards.map((card, j) => (
                <div key={card.title} className={PIN} style={{ zIndex: j + 2 }}>
                  <div className="overflow-hidden rounded-[20px] border border-hairline bg-[#0a0a0a] shadow-[0_-16px_48px_rgba(0,0,0,0.85)]">
                    <p className="px-6 pt-5 text-[13px] font-semibold text-white">
                      {card.title}
                    </p>
                    {/* visual area, tinted by the section hue */}
                    <div
                      className="mx-6 mt-4 h-[170px] rounded-xl"
                      style={{
                        background: `radial-gradient(120% 140% at 20% 0%, ${c.hues[1]}66 0%, transparent 60%), #0d0d0d`,
                      }}
                    />
                    <div className="mt-2 divide-y divide-white/5">
                      {card.rows.map((row) => (
                        <div
                          key={row}
                          className="flex items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-white/[0.03]"
                        >
                          <p className="text-[12.5px] leading-relaxed text-neutral-300">
                            {row}
                          </p>
                          <RowGlyph />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
