import InfoPage from "@/components/info-page";

export const metadata = { title: "Help center — Kodelab" };

export default function HelpPage() {
  return (
    <InfoPage
      title="Help center"
      blurb="Answers to the most common questions about learning on Kodelab."
      sections={[
        {
          heading: "How does progress tracking work?",
          body: "Your progress is saved automatically as you watch. Every lesson you complete is recorded, and the dashboard shows a resume button that takes you back to the exact lesson you left off on.",
        },
        {
          heading: "Do I get a certificate?",
          body: "Yes — finish 100% of a course's lessons and a certificate of completion is issued automatically. Track badges are earned by completing every course in a career track.",
        },
        {
          heading: "Can I preview a course before starting?",
          body: "Every course marks its first lesson as a free preview. Look for the 'Free preview' tag in the curriculum on any course page.",
        },
        {
          heading: "Instructor guide",
          body: "Interested in teaching on Kodelab? We look for working practitioners who can teach one focused idea per lesson. Contact us with a course outline and a two-minute sample video.",
        },
      ]}
    />
  );
}
