import InfoPage from "@/components/info-page";

export const metadata = { title: "Blog — Kodelab" };

export default function BlogPage() {
  return (
    <InfoPage
      title="Blog"
      blurb="Notes on learning, building, and what's new on Kodelab."
      sections={[
        {
          heading: "Changelog — what shipped this month",
          body: "The lesson player got a transcript panel, the catalog got search, and the dashboard now shows per-course completion. Full course content lives in one place, so new courses roll out weekly.",
        },
        {
          heading: "How to actually finish an online course",
          body: "Most people stall in module two. The fix isn't discipline — it's shorter lessons, a visible streak, and a project that makes the next lesson matter. Here's how we design for completion.",
        },
        {
          heading: "Community events",
          body: "Monthly cohort kickoffs, project showcase reviews, and live instructor Q&As. Events are announced here and in your dashboard.",
        },
      ]}
    />
  );
}
