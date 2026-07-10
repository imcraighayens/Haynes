"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import CourseCard from "@/components/course-card";
import CustomCourseCard from "@/components/custom-course-card";
import { categories, courses } from "@/lib/data";
import { CustomCourse, loadConfig } from "@/lib/admin";

export default function Catalog() {
  const params = useSearchParams();
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [customCourses, setCustomCourses] = useState<CustomCourse[]>([]);

  useEffect(() => {
    const sync = () => setCustomCourses(loadConfig().customCourses);
    sync();
    window.addEventListener("kodelab-admin", sync);
    return () => window.removeEventListener("kodelab-admin", sync);
  }, []);

  const q = query.trim().toLowerCase();

  const filtered = courses.filter((c) => {
    const matchesCategory = !category || c.category === category;
    const matchesQuery =
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.tagline.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.instructor.name.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  const filteredCustom = customCourses.filter((c) => {
    const matchesCategory = !category || c.category === category;
    const matchesQuery =
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.tagline.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  const totalResults = filtered.length + filteredCustom.length;

  return (
    <>
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
        {filteredCustom.map((c) => (
          <CustomCourseCard key={c.slug} course={c} />
        ))}
        {filtered.map((c) => (
          <CourseCard key={c.slug} course={c} />
        ))}
      </div>
      {totalResults === 0 && (
        <div className="mt-16 text-center">
          <p className="text-neutral-400">
            No courses match “{query}” yet.
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            Try a broader term, or browse by category above.
          </p>
        </div>
      )}
    </>
  );
}
