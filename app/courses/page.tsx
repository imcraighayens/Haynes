import { Suspense } from "react";
import Catalog from "@/components/catalog";

export const metadata = {
  title: "Courses — Kodelab",
};

export default function CoursesPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-28 pt-32">
      <h1 className="font-display text-4xl font-medium tracking-[-0.03em] text-white md:text-5xl">
        Explore courses
      </h1>
      <p className="mt-3 max-w-lg text-[15px] text-neutral-400">
        Expert-led video courses across design, development, AI, and business.
        Pick a track and start building.
      </p>
      <Suspense>
        <Catalog />
      </Suspense>
    </div>
  );
}
