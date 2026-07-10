"use client";

import { useState } from "react";
import CourseCard from "@/components/course-card";
import { categories, courses } from "@/lib/data";

export default function CoursesPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = courses.filter((c) => {
    const matchesCategory = !category || c.category === category;
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.tagline.toLowerCase().includes(q) ||
      c.instructor.name.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="mx-auto max-w-6xl px-6 pb-28 pt-32">
      <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
        Explore courses
      </h1>
      <p className="mt-3 max-w-lg text-[15px] text-neutral-400">
        Expert-led video courses across design, development, AI, and business.
        Pick a track and start building.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCategory(null)}
          className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
            category === null
              ? "bg-white font-medium text-black"
              : "bg-neutral-900 text-neutral-300 ring-1 ring-white/10 hover:bg-neutral-800"
          }`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c === category ? null : c)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              category === c
                ? "bg-white font-medium text-black"
                : "bg-neutral-900 text-neutral-300 ring-1 ring-white/10 hover:bg-neutral-800"
            }`}
          >
            {c}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search courses…"
          className="ml-auto w-full rounded-full bg-neutral-900 px-4 py-1.5 text-sm text-white placeholder-neutral-500 ring-1 ring-white/10 outline-none focus:ring-white/30 md:w-64"
        />
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {filtered.map((c) => (
          <CourseCard key={c.slug} course={c} />
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="mt-16 text-center text-neutral-500">
          No courses match your search.
        </p>
      )}
    </div>
  );
}
