import Link from "next/link";

const columns: { title: string; items: { label: string; href: string }[] }[] = [
  {
    title: "Learn",
    items: [
      { label: "All courses", href: "/courses" },
      { label: "My learning", href: "/dashboard" },
      { label: "Career tracks", href: "/courses" },
      { label: "Certificates", href: "/courses" },
      { label: "Free previews", href: "/courses" },
    ],
  },
  {
    title: "Community",
    items: [
      { label: "Study groups", href: "/#" },
      { label: "Mentors", href: "/#" },
      { label: "Events", href: "/#" },
      { label: "Showcase", href: "/#" },
      { label: "Discord", href: "/#" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Blog", href: "/#" },
      { label: "Help center", href: "/#" },
      { label: "Instructor guide", href: "/#" },
      { label: "Changelog", href: "/#" },
      { label: "Status", href: "/#" },
    ],
  },
  {
    title: "Tracks",
    items: [
      { label: "Design", href: "/courses" },
      { label: "Development", href: "/courses" },
      { label: "AI", href: "/courses" },
      { label: "Video", href: "/courses" },
      { label: "Business", href: "/courses" },
    ],
  },
  {
    title: "Compare",
    items: [
      { label: "Kodelab vs Coursera", href: "/courses" },
      { label: "Kodelab vs Udemy", href: "/courses" },
      { label: "Kodelab vs YouTube", href: "/courses" },
      { label: "Switching guide", href: "/courses" },
    ],
  },
  {
    title: "Company",
    items: [
      { label: "About", href: "/#" },
      { label: "Careers", href: "/#" },
      { label: "For teams", href: "/#" },
      { label: "Privacy", href: "/#" },
      { label: "Terms", href: "/#" },
    ],
  },
];

const socials = [
  {
    label: "X",
    icon: (
      <path d="M3 3l12 12M15 3L3 15" />
    ),
  },
  {
    label: "YouTube",
    icon: (
      <>
        <rect x="2" y="4.5" width="14" height="9" rx="2.5" />
        <path d="M7.5 7l3.5 2-3.5 2V7z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    label: "GitHub",
    icon: (
      <path d="M9 2a7 7 0 0 0-2.2 13.6c.35.07.48-.15.48-.34v-1.2c-1.95.42-2.36-.94-2.36-.94-.32-.8-.78-1-.78-1-.63-.44.05-.43.05-.43.7.05 1.07.72 1.07.72.63 1.07 1.64.76 2.04.58.06-.45.24-.76.44-.94-1.56-.18-3.2-.78-3.2-3.46 0-.77.28-1.4.72-1.88-.07-.18-.31-.9.07-1.86 0 0 .59-.19 1.92.72a6.7 6.7 0 0 1 3.5 0c1.33-.9 1.92-.72 1.92-.72.38.97.14 1.68.07 1.86.45.49.72 1.11.72 1.88 0 2.69-1.64 3.28-3.2 3.45.25.22.47.64.47 1.29v1.91c0 .19.13.41.49.34A7 7 0 0 0 9 2z" fill="currentColor" stroke="none" />
    ),
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-hairline bg-black">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:grid-cols-6">
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-[13px] font-semibold text-white">{col.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.items.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="text-[13px] text-neutral-500 transition-colors hover:text-white"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-6 border-t border-hairline pt-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white">
              K
            </span>
            <div className="flex items-center gap-3">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href="#"
                  aria-label={s.label}
                  className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-neutral-400 transition-colors hover:border-white/30 hover:text-white"
                >
                  <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    {s.icon}
                  </svg>
                </a>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-[12px] text-neutral-600">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              All systems operational
            </span>
            <span>© {new Date().getFullYear()} Kodelab. All rights reserved.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
