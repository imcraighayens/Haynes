export type IconName =
  | "refresh"
  | "image"
  | "pencil"
  | "arrow"
  | "expand"
  | "cube"
  | "search"
  | "database"
  | "check"
  | "spark";

const paths: Record<IconName, React.ReactNode> = {
  refresh: (
    <path d="M3 9a6 6 0 0 1 10.7-3.7M15 9A6 6 0 0 1 4.3 12.7M13.5 2.5v3h-3M4.5 15.5v-3h3" />
  ),
  image: (
    <>
      <rect x="2.5" y="2.5" width="13" height="13" rx="2" />
      <circle cx="6.5" cy="6.5" r="1.2" />
      <path d="M15 11.5l-3.5-3.5-7 7" />
    </>
  ),
  pencil: <path d="M3 15l.8-3.2L12.5 3l2.5 2.5-8.7 8.7L3 15zM11 4.5L13.5 7" />,
  arrow: <path d="M3 9h12M10.5 4.5L15 9l-4.5 4.5" />,
  expand: <path d="M11 3h4v4M7 15H3v-4M15 3l-5 5M3 15l5-5" />,
  cube: <path d="M9 2l6 3.5v7L9 16l-6-3.5v-7L9 2zM3 5.5l6 3.5 6-3.5M9 9v7" />,
  search: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M12 12l4 4" />
    </>
  ),
  database: (
    <>
      <ellipse cx="9" cy="4.5" rx="6" ry="2.5" />
      <path d="M3 4.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M3 9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
    </>
  ),
  check: (
    <>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M6 9.2l2 2 4-4.2" />
    </>
  ),
  spark: (
    <path d="M9 2v3M9 13v3M2 9h3M13 9h3M4.2 4.2l2 2M11.8 11.8l2 2M13.8 4.2l-2 2M6.2 11.8l-2 2" />
  ),
};

export default function Icon({
  name,
  size = 18,
  strokeWidth = 1.3,
  className = "",
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
