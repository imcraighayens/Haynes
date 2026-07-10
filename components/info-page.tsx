import Link from "next/link";

export default function InfoPage({
  title,
  blurb,
  sections,
}: {
  title: string;
  blurb: string;
  sections: { heading: string; body: string }[];
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 pb-28 pt-32">
      <h1 className="font-display text-4xl font-medium tracking-[-0.04em] text-white md:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-neutral-400">
        {blurb}
      </p>
      <div className="mt-12 space-y-8">
        {sections.map((s) => (
          <div
            key={s.heading}
            className="rounded-2xl border border-hairline bg-neutral-950 p-6"
          >
            <h2 className="text-[15px] font-semibold text-white">{s.heading}</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">{s.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-12 flex gap-3">
        <Link
          href="/courses"
          className="rounded-lg bg-white px-3.5 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-85"
        >
          Browse courses
        </Link>
        <Link
          href="/"
          className="rounded-lg bg-white/10 px-3.5 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/15"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
