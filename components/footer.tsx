import Link from "next/link";

const columns: { title: string; items: { label: string; href: string }[] }[] = [
  {
    title: "Learn",
    items: [
      { label: "All courses", href: "/courses" },
      { label: "My learning", href: "/dashboard" },
      { label: "Certificates", href: "/#features" },
      { label: "For teams", href: "/#features" },
    ],
  },
  {
    title: "Community",
    items: [
      { label: "Study groups", href: "/#community" },
      { label: "Mentors", href: "/#community" },
      { label: "Events", href: "/#community" },
      { label: "Showcase", href: "/#community" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Blog", href: "/#resources" },
      { label: "Help center", href: "/#resources" },
      { label: "Career paths", href: "/#resources" },
      { label: "Changelog", href: "/#resources" },
    ],
  },
  {
    title: "Company",
    items: [
      { label: "About", href: "/#" },
      { label: "Careers", href: "/#" },
      { label: "Privacy", href: "/#" },
      { label: "Terms", href: "/#" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white">
                K
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-white">Kodelab</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-neutral-500">
              The video school for modern skills. Learn from experts, build real
              projects, and ship your career forward.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-medium text-white">{col.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.items.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="text-sm text-neutral-500 transition-colors hover:text-white"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-8 text-sm text-neutral-600 md:flex-row">
          <p>© {new Date().getFullYear()} Kodelab. All rights reserved.</p>
          <p>Made for people who learn by doing.</p>
        </div>
      </div>
    </footer>
  );
}
