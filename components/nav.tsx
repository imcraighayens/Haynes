"use client";

import Link from "next/link";
import { useState } from "react";

const links = [
  { href: "/courses", label: "Courses" },
  { href: "/#product", label: "Product" },
  { href: "/#mentors", label: "Community" },
  { href: "/#resources", label: "Resources" },
  { href: "/dashboard", label: "My Learning" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-black/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white">
            K
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-white">Kodelab</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((l, i) => (
            <Link
              key={l.label}
              href={l.href}
              className={`text-[13px] font-medium transition-colors hover:text-white ${
                i === 0 ? "text-white" : "text-neutral-500"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto hidden items-center md:flex">
          <Link
            href="/dashboard"
            aria-label="Your profile and learning"
            className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 text-xs font-semibold text-white transition-transform hover:scale-105"
          >
            H
          </Link>
        </div>

        <button
          className="ml-auto grid h-8 w-8 place-items-center text-neutral-300 md:hidden"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            {open ? (
              <path d="M3 3l12 12M15 3L3 15" />
            ) : (
              <path d="M2 5h14M2 9h14M2 13h14" />
            )}
          </svg>
        </button>
      </nav>

      {open && (
        <div className="border-t border-white/10 bg-black px-6 py-4 md:hidden">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-2.5 text-sm text-neutral-300 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/courses"
            onClick={() => setOpen(false)}
            className="mt-3 inline-block rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black"
          >
            Get started
          </Link>
        </div>
      )}
    </header>
  );
}
