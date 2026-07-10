"use client";

import { useEffect, useState } from "react";

/* Shared tick — one interval driving all looping mocks keeps them in step */
function useTick(ms: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

function Typewriter({ phrases }: { phrases: string[] }) {
  const [text, setText] = useState("");
  useEffect(() => {
    let phrase = 0;
    let char = 0;
    let deleting = false;
    let id: ReturnType<typeof setTimeout>;
    const step = () => {
      const current = phrases[phrase];
      if (!deleting) {
        char++;
        if (char === current.length) {
          deleting = true;
          id = setTimeout(step, 1600);
          setText(current);
          return;
        }
      } else {
        char--;
        if (char === 0) {
          deleting = false;
          phrase = (phrase + 1) % phrases.length;
        }
      }
      setText(current.slice(0, char));
      id = setTimeout(step, deleting ? 28 : 55);
    };
    id = setTimeout(step, 400);
    return () => clearTimeout(id);
  }, [phrases]);
  return (
    <span>
      {text}
      <span className="caret-blink text-neutral-400">|</span>
    </span>
  );
}

/* Cell mocks ------------------------------------------------------------- */

function SearchMock() {
  return (
    <div className="flex w-full items-center gap-2 rounded-lg border border-white/15 bg-neutral-950 px-3 py-2.5 text-[12px] text-neutral-300">
      <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-neutral-500">
        <circle cx="8" cy="8" r="5" />
        <path d="M12 12l4 4" />
      </svg>
      <Typewriter
        phrases={[
          "react server components",
          "three-point lighting",
          "positioning for startups",
        ]}
      />
    </div>
  );
}

function NotesMock() {
  const tick = useTick(1400);
  const words = ["hooks", "run", "after", "every", "render"];
  const hot = tick % words.length;
  return (
    <p className="text-[13px] leading-relaxed text-neutral-300">
      Remember:{" "}
      {words.map((w, i) => (
        <span
          key={w}
          className={`rounded px-0.5 transition-colors duration-300 ${
            i === hot ? "bg-violet-500/40 text-white" : ""
          }`}
        >
          {w}{" "}
        </span>
      ))}
      unless you memoize.
    </p>
  );
}

function LessonsMock() {
  const tick = useTick(1600);
  const rows = ["Hooks in depth", "Spacing scales", "Clean audio", "RAG basics"];
  const hot = tick % rows.length;
  return (
    <div className="w-full space-y-1 rounded-lg border border-white/15 bg-neutral-950 p-1.5">
      {rows.map((r, i) => (
        <div
          key={r}
          className={`rounded px-2.5 py-1.5 text-[12px] transition-colors duration-300 ${
            i === hot ? "bg-white/10 text-white" : "text-neutral-500"
          }`}
        >
          {r}
        </div>
      ))}
    </div>
  );
}

function TracksMock() {
  const tick = useTick(1800);
  const tracks = ["Design", "Development", "AI", "Business"];
  const hot = tick % tracks.length;
  return (
    <div className="w-full space-y-1 rounded-lg border border-white/15 bg-neutral-950 p-1.5">
      {tracks.map((t, i) => (
        <div
          key={t}
          className="flex items-center justify-between rounded px-2.5 py-1.5 text-[12px] text-neutral-400"
        >
          {t}
          <span
            className={`transition-opacity duration-300 ${
              i === hot ? "opacity-100 text-emerald-400" : "opacity-0"
            }`}
          >
            ✓
          </span>
        </div>
      ))}
    </div>
  );
}

function MentionsMock() {
  const tick = useTick(2200);
  const on = tick % 2 === 0;
  return (
    <p className="text-[13px] leading-relaxed text-neutral-300">
      Can you review my final project,{" "}
      <span
        className={`rounded-md px-1.5 py-0.5 text-[12px] font-medium transition-all duration-300 ${
          on
            ? "bg-violet-500/25 text-violet-200"
            : "bg-transparent text-neutral-600"
        }`}
      >
        @maya
      </span>
      ?
    </p>
  );
}

function ResourcesMock() {
  const tick = useTick(1500);
  const files: [string, string][] = [
    ["mp4", "Lesson recording"],
    ["pdf", "Slides & notes"],
    ["md", "Cheat sheet"],
    ["tsx", "Starter code"],
    ["png", "Design assets"],
    ["csv", "Sample data"],
  ];
  const hot = tick % files.length;
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex gap-2">
        {files.map(([ext], i) => (
          <span
            key={ext}
            className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase transition-all duration-300 ${
              i === hot
                ? "border-white/60 text-white"
                : "border-white/10 text-neutral-600"
            }`}
          >
            {ext}
          </span>
        ))}
      </div>
      <p className="text-[12px] text-neutral-500">{files[hot][1]}</p>
    </div>
  );
}

function PlaylistsMock() {
  const tick = useTick(2000);
  const on = tick % 2 === 0;
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex rounded-lg border border-white/15 bg-neutral-950 p-1 text-[12px]">
        <span
          className={`rounded-md px-3 py-1 transition-colors duration-300 ${
            on ? "bg-white/10 text-white" : "text-neutral-500"
          }`}
        >
          Up next
        </span>
        <span
          className={`rounded-md px-3 py-1 transition-colors duration-300 ${
            !on ? "bg-white/10 text-white" : "text-neutral-500"
          }`}
        >
          Saved
        </span>
      </div>
      <p className="text-[12px] text-neutral-500">
        {on ? "3 lessons queued for today" : "12 courses saved for later"}
      </p>
    </div>
  );
}

/* Grid ------------------------------------------------------------------- */

const cells: { label: string; body: string; mock: React.ReactNode }[] = [
  {
    label: "Search",
    body: "Find the exact lesson that answers your question.",
    mock: <SearchMock />,
  },
  {
    label: "Notes",
    body: "Highlight key moments and they're saved to the lesson.",
    mock: <NotesMock />,
  },
  {
    label: "Lessons",
    body: "Jump back into anything you've watched recently.",
    mock: <LessonsMock />,
  },
  {
    label: "Tracks",
    body: "Switch career tracks without losing your progress.",
    mock: <TracksMock />,
  },
  {
    label: "Mentions",
    body: "Pull an instructor or mentor into any discussion.",
    mock: <MentionsMock />,
  },
  {
    label: "Resources",
    body: "Every lesson ships with its files, code, and notes.",
    mock: <ResourcesMock />,
  },
  {
    label: "Playlists",
    body: "Queue lessons for today or save whole courses for later.",
    mock: <PlaylistsMock />,
  },
];

export default function Toolkit() {
  return (
    <section className="mx-auto mt-32 max-w-6xl px-6">
      <h2 className="max-w-xl font-display text-[34px] font-medium leading-[1.1] tracking-[-0.04em] text-white">
        Your toolkit for learning with Kodelab
      </h2>
      <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-hairline bg-white/[0.08] sm:grid-cols-2 lg:grid-cols-3">
        {cells.map((cell) => (
          <div key={cell.label} className="flex flex-col bg-black">
            <div className="grid min-h-[150px] flex-1 place-items-center border-b border-hairline p-6">
              {cell.mock}
            </div>
            <div className="p-5">
              <p className="text-[13px] font-semibold text-white">{cell.label}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
                {cell.body}
              </p>
            </div>
          </div>
        ))}
        {/* filler cells keep the grid rectangular at each breakpoint */}
        <div className="hidden bg-black sm:block" />
        <div className="hidden bg-black lg:block" />
      </div>
    </section>
  );
}
