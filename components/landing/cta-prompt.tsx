"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const suggestions = [
  "Teach me React from scratch",
  "I want to shoot better video",
  "Get me started with AI",
  "Marketing for my startup",
];

export default function CtaPrompt() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [placeholder, setPlaceholder] = useState("");

  /* Looping typewriter placeholder */
  useEffect(() => {
    let phrase = 0;
    let char = 0;
    let deleting = false;
    let id: ReturnType<typeof setTimeout>;
    const step = () => {
      const current = suggestions[phrase];
      if (!deleting) {
        char++;
        if (char === current.length) {
          deleting = true;
          setPlaceholder(current);
          id = setTimeout(step, 1800);
          return;
        }
      } else {
        char--;
        if (char === 0) {
          deleting = false;
          phrase = (phrase + 1) % suggestions.length;
        }
      }
      setPlaceholder(current.slice(0, char));
      id = setTimeout(step, deleting ? 25 : 60);
    };
    id = setTimeout(step, 500);
    return () => clearTimeout(id);
  }, []);

  const go = (q: string) =>
    router.push(q.trim() ? `/courses?q=${encodeURIComponent(q.trim())}` : "/courses");

  return (
    <section className="mx-auto my-32 max-w-3xl px-6 text-center">
      <h2 className="font-display text-[34px] font-medium leading-[1.1] tracking-[-0.04em] text-white md:text-[44px]">
        What do you want to learn?
      </h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        className="relative mx-auto mt-8 max-w-xl"
      >
        <div className="flex items-center gap-3 rounded-2xl border border-blue-500/60 bg-neutral-950 py-2 pl-5 pr-2 shadow-[0_0_50px_rgba(59,130,246,0.3)]">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            aria-label="What do you want to learn?"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder-neutral-500 outline-none"
          />
          <button
            type="submit"
            aria-label="Search courses"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-black transition-opacity hover:opacity-85"
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9h12M10.5 4.5L15 9l-4.5 4.5" />
            </svg>
          </button>
        </div>
      </form>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => go(s)}
            className="rounded-lg border border-white/25 bg-white/5 px-3.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-white/10"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
