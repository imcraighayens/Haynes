"use client";

import { useEffect, useRef, useState } from "react";
import { isStoredVideo, resolveSrc } from "@/lib/videoStore";

export type TranscriptLine = { t: number; text: string };

const defaultTranscript: TranscriptLine[] = [
  { t: 0, text: "Welcome in — here's what we're covering in this lesson and why it matters for the project you'll build." },
  { t: 9, text: "Before we start, make sure you've watched the previous lesson, because we'll build directly on that setup." },
  { t: 21, text: "First, the core idea. I'll show you the finished result so you know exactly where we're heading." },
  { t: 34, text: "Notice what happens here — this is the part most people get wrong, and it's worth slowing down for." },
  { t: 47, text: "Let's do it together step by step. Pause the video and try each step yourself before moving on." },
  { t: 62, text: "If your result looks different, check the resources panel — the starter files include a checkpoint you can compare against." },
  { t: 78, text: "Now we'll take it one level deeper and handle the edge cases you'll actually meet in real work." },
  { t: 94, text: "This pattern comes back in the module project, so make sure it feels comfortable before continuing." },
  { t: 110, text: "Quick recap of what we did and the one thing to remember if you forget everything else." },
  { t: 124, text: "In the next lesson we'll put this into practice — see you there." },
];

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function VideoCard({
  src,
  title = "Lesson preview",
  transcript = defaultTranscript,
  className = "",
}: {
  src: string;
  title?: string;
  transcript?: TranscriptLine[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);

  /* Resolve stored (uploaded) videos to object URLs; pass plain URLs through */
  const [resolved, setResolved] = useState(isStoredVideo(src) ? "" : src);
  useEffect(() => {
    let revokeUrl: string | null = null;
    let cancelled = false;
    resolveSrc(src).then((r) => {
      if (cancelled || !r) return;
      setResolved(r.url);
      if (r.revoke) revokeUrl = r.url;
    });
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [src]);

  /* Esc closes; lock page scroll while the popup is open */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* Keep the active transcript line in view as the video plays */
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [time]);

  const activeIndex = transcript.reduce(
    (acc, line, i) => (time >= line.t ? i : acc),
    0
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Play video: ${title}`}
        className={`group relative block w-full cursor-pointer overflow-hidden rounded-2xl bg-neutral-900 text-left ${className}`}
      >
        <video src={resolved} preload="metadata" muted playsInline tabIndex={-1} className="h-full w-full object-cover" />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/60 backdrop-blur transition-transform group-hover:scale-110">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
              <path d="M6 4.5v11l9-5.5-9-5.5z" />
            </svg>
          </span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4 backdrop-blur-sm md:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="grid max-h-[90vh] w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Video panel */}
            <div className="relative overflow-hidden rounded-2xl border border-hairline bg-black">
              <video
                ref={videoRef}
                src={resolved}
                controls
                autoPlay
                playsInline
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                className="aspect-video w-full bg-black"
              />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close video"
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
              >
                <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M4 4l10 10M14 4L4 14" />
                </svg>
              </button>
            </div>

            {/* Transcript side card */}
            <aside className="flex max-h-[60vh] flex-col overflow-hidden rounded-2xl border border-hairline bg-neutral-950 lg:max-h-none">
              <div className="border-b border-hairline px-5 py-4">
                <p className="text-[13px] font-semibold text-white">Transcript</p>
                <p className="mt-0.5 line-clamp-1 text-[12px] text-neutral-500">{title}</p>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto p-3">
                {transcript.map((line, i) => (
                  <button
                    key={line.t}
                    ref={i === activeIndex ? activeLineRef : undefined}
                    onClick={() => {
                      if (videoRef.current) videoRef.current.currentTime = line.t;
                    }}
                    className={`flex w-full gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      i === activeIndex
                        ? "bg-white/10"
                        : "hover:bg-white/5"
                    }`}
                  >
                    <span
                      className={`shrink-0 text-[11px] tabular-nums ${
                        i === activeIndex ? "text-violet-300" : "text-neutral-600"
                      }`}
                    >
                      {formatTime(line.t)}
                    </span>
                    <span
                      className={`text-[12.5px] leading-relaxed ${
                        i === activeIndex ? "text-white" : "text-neutral-400"
                      }`}
                    >
                      {line.text}
                    </span>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
