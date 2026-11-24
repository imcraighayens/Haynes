import InfoPage from "@/components/info-page";

export const metadata = { title: "About — Kodelab" };

export default function AboutPage() {
  return (
    <InfoPage
      title="About Kodelab"
      blurb="Kodelab is a video school for modern skills — expert-led courses, real projects, and progress that follows you everywhere."
      sections={[
        {
          heading: "What we believe",
          body: "People learn by doing. Every Kodelab course pairs short, focused video lessons with hands-on projects, so you finish with real work to show — not just a watch history.",
        },
        {
          heading: "Careers",
          body: "We're a small team and we hire occasionally for engineering, curriculum, and community roles. Openings are announced on the blog first.",
        },
        {
          heading: "For teams",
          body: "Kodelab for Teams brings tracks, progress reporting, and seat management to companies training groups of five or more. Reach out from your team account to get set up.",
        },
      ]}
    />
  );
}
