# Kodelab

A video school platform (think Coursera) with a dark, Framer-inspired landing page. Built with Next.js 16, React 19, and Tailwind CSS 4 — fully self-owned code you can modify freely.

## Pages

- `/` — Landing page: hero, 5×2 feature grid, gradient + video showcase cards, stats, alternating feature sections, popular courses, testimonial, CTA
- `/courses` — Course catalog with category filters and search
- `/courses/[slug]` — Course detail: header, curriculum by module, instructor sidebar
- `/courses/[slug]/learn/[lessonId]` — Lesson player with module sidebar, completion tracking, auto-advance
- `/dashboard` — My Learning: resume courses, per-course progress bars

## How it works

- Course content lives in `lib/data.ts` — edit it to add/change courses, modules, and lessons. Lesson videos are plain MP4 URLs (currently public sample videos as placeholders).
- Learner progress is stored in `localStorage` (`lib/progress.ts`) — no backend required. Swap this for a database/auth layer when ready.
- All styling is Tailwind utility classes; the design system is black background, `white/10` borders, violet accent gradients.

## Develop

```bash
npm install
npm run dev   # http://localhost:3000
npm run build # production build
```
