import InfoPage from "@/components/info-page";

export const metadata = { title: "Privacy & Terms — Kodelab" };

export default function LegalPage() {
  return (
    <InfoPage
      title="Privacy & Terms"
      blurb="The short version of how Kodelab handles your data and what you agree to by using it."
      sections={[
        {
          heading: "Privacy",
          body: "Your learning progress is currently stored in your own browser's local storage — it never leaves your device. If accounts are added later, this page will describe exactly what is stored and where.",
        },
        {
          heading: "Terms of use",
          body: "Kodelab courses are for your personal learning. Don't redistribute course videos or materials. Certificates represent completion of course content, not accreditation.",
        },
        {
          heading: "Contact",
          body: "Questions about privacy or terms? Reach out through the help center and we'll get back to you.",
        },
      ]}
    />
  );
}
