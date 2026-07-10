export type Lesson = {
  id: string;
  title: string;
  duration: string;
  videoUrl: string;
  preview?: boolean;
};

export type Module = {
  title: string;
  lessons: Lesson[];
};

export type Course = {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  category: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  hours: number;
  rating: number;
  students: number;
  instructor: { name: string; role: string; initials: string };
  gradient: string;
  modules: Module[];
};

const v = (name: string) =>
  `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/${name}.mp4`;

export const courses: Course[] = [
  {
    slug: "web-design-fundamentals",
    title: "Web Design Fundamentals",
    tagline: "Design modern, responsive sites people love to use.",
    description:
      "Learn the core principles of visual design — layout, typography, color, and spacing — and apply them to real responsive websites. By the end of this course you will be able to take a product idea from a rough sketch to a polished, production-ready design.",
    category: "Design",
    level: "Beginner",
    hours: 8,
    rating: 4.8,
    students: 12840,
    instructor: { name: "Maya Chen", role: "Principal Designer, Northwind", initials: "MC" },
    gradient: "from-violet-600 via-purple-500 to-indigo-700",
    modules: [
      {
        title: "Design foundations",
        lessons: [
          { id: "wdf-1-1", title: "How designers think", duration: "9:42", videoUrl: v("BigBuckBunny"), preview: true },
          { id: "wdf-1-2", title: "Layout and visual hierarchy", duration: "12:18", videoUrl: v("ElephantsDream") },
          { id: "wdf-1-3", title: "Typography that works", duration: "10:05", videoUrl: v("ForBiggerBlazes") },
        ],
      },
      {
        title: "Color and spacing systems",
        lessons: [
          { id: "wdf-2-1", title: "Building a color palette", duration: "11:30", videoUrl: v("ForBiggerEscapes") },
          { id: "wdf-2-2", title: "Spacing scales and grids", duration: "8:47", videoUrl: v("ForBiggerFun") },
          { id: "wdf-2-3", title: "Dark mode done right", duration: "13:02", videoUrl: v("ForBiggerJoyrides") },
        ],
      },
      {
        title: "Responsive design in practice",
        lessons: [
          { id: "wdf-3-1", title: "Mobile-first thinking", duration: "10:56", videoUrl: v("ForBiggerMeltdowns") },
          { id: "wdf-3-2", title: "Breakpoints and fluid layouts", duration: "14:21", videoUrl: v("Sintel") },
          { id: "wdf-3-3", title: "Final project: full site design", duration: "22:10", videoUrl: v("TearsOfSteel") },
        ],
      },
    ],
  },
  {
    slug: "react-nextjs-mastery",
    title: "React & Next.js Mastery",
    tagline: "Ship fast, modern web apps with the React ecosystem.",
    description:
      "Go from React fundamentals to production-grade Next.js applications. Covers components, hooks, server components, data fetching, routing, and deployment — with a project you build along the way.",
    category: "Development",
    level: "Intermediate",
    hours: 14,
    rating: 4.9,
    students: 21673,
    instructor: { name: "Andre Okafor", role: "Staff Engineer, Lumen Labs", initials: "AO" },
    gradient: "from-sky-500 via-cyan-400 to-blue-700",
    modules: [
      {
        title: "React essentials",
        lessons: [
          { id: "rnm-1-1", title: "Components and props", duration: "13:44", videoUrl: v("BigBuckBunny"), preview: true },
          { id: "rnm-1-2", title: "State and events", duration: "15:12", videoUrl: v("ForBiggerBlazes") },
          { id: "rnm-1-3", title: "Hooks in depth", duration: "18:30", videoUrl: v("ElephantsDream") },
        ],
      },
      {
        title: "Next.js app router",
        lessons: [
          { id: "rnm-2-1", title: "Pages, layouts, and routing", duration: "12:08", videoUrl: v("Sintel") },
          { id: "rnm-2-2", title: "Server vs client components", duration: "16:40", videoUrl: v("ForBiggerEscapes") },
          { id: "rnm-2-3", title: "Data fetching and caching", duration: "17:25", videoUrl: v("ForBiggerFun") },
        ],
      },
      {
        title: "Shipping to production",
        lessons: [
          { id: "rnm-3-1", title: "Performance and Core Web Vitals", duration: "14:03", videoUrl: v("TearsOfSteel") },
          { id: "rnm-3-2", title: "Deploying and monitoring", duration: "11:52", videoUrl: v("ForBiggerJoyrides") },
        ],
      },
    ],
  },
  {
    slug: "ai-for-builders",
    title: "AI for Builders",
    tagline: "Integrate large language models into real products.",
    description:
      "A practical course on building with LLMs: prompting, tool use, retrieval, agents, and evaluation. You will build an AI-powered feature end to end and learn how to make it reliable enough to ship.",
    category: "AI",
    level: "Intermediate",
    hours: 10,
    rating: 4.7,
    students: 18452,
    instructor: { name: "Sofia Reyes", role: "AI Product Lead, Vector", initials: "SR" },
    gradient: "from-fuchsia-600 via-pink-500 to-rose-600",
    modules: [
      {
        title: "LLM foundations",
        lessons: [
          { id: "aib-1-1", title: "How language models work", duration: "12:15", videoUrl: v("ElephantsDream"), preview: true },
          { id: "aib-1-2", title: "Prompting patterns that scale", duration: "14:38", videoUrl: v("ForBiggerMeltdowns") },
          { id: "aib-1-3", title: "Structured output and tool use", duration: "16:02", videoUrl: v("BigBuckBunny") },
        ],
      },
      {
        title: "Building AI features",
        lessons: [
          { id: "aib-2-1", title: "Retrieval-augmented generation", duration: "18:24", videoUrl: v("Sintel") },
          { id: "aib-2-2", title: "Agents and workflows", duration: "15:47", videoUrl: v("TearsOfSteel") },
          { id: "aib-2-3", title: "Evals: measuring quality", duration: "13:31", videoUrl: v("ForBiggerFun") },
        ],
      },
    ],
  },
  {
    slug: "video-production-essentials",
    title: "Video Production Essentials",
    tagline: "Plan, shoot, and edit video that looks professional.",
    description:
      "From storyboarding to color grading — everything you need to produce high-quality video on a realistic budget. Includes lighting setups, audio capture, and a complete edit walkthrough.",
    category: "Video",
    level: "Beginner",
    hours: 9,
    rating: 4.6,
    students: 9310,
    instructor: { name: "Jonas Berg", role: "Filmmaker & Educator", initials: "JB" },
    gradient: "from-amber-500 via-orange-500 to-red-600",
    modules: [
      {
        title: "Pre-production",
        lessons: [
          { id: "vpe-1-1", title: "Storyboarding your idea", duration: "8:55", videoUrl: v("ForBiggerJoyrides"), preview: true },
          { id: "vpe-1-2", title: "Gear that matters (and gear that doesn't)", duration: "12:44", videoUrl: v("SubaruOutbackOnStreetAndDirt") },
        ],
      },
      {
        title: "Shooting",
        lessons: [
          { id: "vpe-2-1", title: "Three-point lighting", duration: "10:12", videoUrl: v("VolkswagenGTIReview") },
          { id: "vpe-2-2", title: "Clean audio every time", duration: "9:38", videoUrl: v("WeAreGoingOnBullrun") },
          { id: "vpe-2-3", title: "Framing and camera movement", duration: "13:20", videoUrl: v("WhatCarCanYouGetForAGrand") },
        ],
      },
      {
        title: "Post-production",
        lessons: [
          { id: "vpe-3-1", title: "The edit: rhythm and story", duration: "16:41", videoUrl: v("TearsOfSteel") },
          { id: "vpe-3-2", title: "Color grading fundamentals", duration: "11:29", videoUrl: v("Sintel") },
        ],
      },
    ],
  },
  {
    slug: "startup-marketing-101",
    title: "Startup Marketing 101",
    tagline: "Find your first 1,000 customers without a big budget.",
    description:
      "A no-fluff marketing course for founders and early teams. Positioning, landing pages that convert, content and SEO, paid experiments, and analytics — with frameworks you can apply the same day.",
    category: "Marketing",
    level: "Beginner",
    hours: 6,
    rating: 4.5,
    students: 7204,
    instructor: { name: "Priya Nair", role: "Growth Advisor, ex-Shopline", initials: "PN" },
    gradient: "from-emerald-500 via-teal-400 to-cyan-600",
    modules: [
      {
        title: "Positioning and message",
        lessons: [
          { id: "sm-1-1", title: "Positioning in one afternoon", duration: "11:07", videoUrl: v("ForBiggerFun"), preview: true },
          { id: "sm-1-2", title: "Landing pages that convert", duration: "13:53", videoUrl: v("BigBuckBunny") },
        ],
      },
      {
        title: "Channels and experiments",
        lessons: [
          { id: "sm-2-1", title: "Content and SEO for startups", duration: "15:26", videoUrl: v("ElephantsDream") },
          { id: "sm-2-2", title: "Running paid experiments", duration: "12:10", videoUrl: v("ForBiggerEscapes") },
          { id: "sm-2-3", title: "Analytics that drive decisions", duration: "10:48", videoUrl: v("ForBiggerBlazes") },
        ],
      },
    ],
  },
  {
    slug: "product-management-in-practice",
    title: "Product Management in Practice",
    tagline: "Turn ambiguous problems into products that ship.",
    description:
      "Learn the day-to-day craft of product management: discovery, prioritization, specs, working with engineers and designers, and shipping iteratively. Taught through real case studies.",
    category: "Business",
    level: "Advanced",
    hours: 12,
    rating: 4.8,
    students: 11986,
    instructor: { name: "Daniel Kim", role: "VP Product, Fieldstone", initials: "DK" },
    gradient: "from-indigo-600 via-blue-500 to-violet-700",
    modules: [
      {
        title: "Discovery",
        lessons: [
          { id: "pm-1-1", title: "Finding problems worth solving", duration: "14:32", videoUrl: v("Sintel"), preview: true },
          { id: "pm-1-2", title: "Customer interviews that reveal truth", duration: "16:15", videoUrl: v("TearsOfSteel") },
        ],
      },
      {
        title: "Delivery",
        lessons: [
          { id: "pm-2-1", title: "Prioritization frameworks", duration: "12:58", videoUrl: v("ForBiggerMeltdowns") },
          { id: "pm-2-2", title: "Writing specs people read", duration: "11:36", videoUrl: v("ForBiggerJoyrides") },
          { id: "pm-2-3", title: "Shipping and iterating", duration: "13:44", videoUrl: v("BigBuckBunny") },
        ],
      },
    ],
  },
];

export const categories = [...new Set(courses.map((c) => c.category))];

export function getCourse(slug: string): Course | undefined {
  return courses.find((c) => c.slug === slug);
}

export function allLessons(course: Course): Lesson[] {
  return course.modules.flatMap((m) => m.lessons);
}

export function lessonCount(course: Course): number {
  return allLessons(course).length;
}
