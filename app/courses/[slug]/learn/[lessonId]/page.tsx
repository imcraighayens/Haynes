import { notFound } from "next/navigation";
import Player from "@/components/player";
import { allLessons, courses, getCourse } from "@/lib/data";

export function generateStaticParams() {
  return courses.flatMap((c) =>
    allLessons(c).map((l) => ({ slug: c.slug, lessonId: l.id }))
  );
}

export default async function LearnPage({
  params,
}: {
  params: Promise<{ slug: string; lessonId: string }>;
}) {
  const { slug, lessonId } = await params;
  const course = getCourse(slug);
  if (!course || !allLessons(course).some((l) => l.id === lessonId)) notFound();

  return <Player course={course} lessonId={lessonId} />;
}
