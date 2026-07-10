"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { categories as staticCategories, courses as staticCourses } from "@/lib/data";
import {
  AdminConfig,
  CustomCourse,
  CustomLesson,
  deleteCourse,
  isUnlocked,
  loadConfig,
  lock,
  setShowcaseVideo,
  slugify,
  unlock,
  upsertCourse,
} from "@/lib/admin";

/* Section ids must match those in components/landing/showcase.tsx */
const showcaseSections: { id: string; label: string }[] = [
  { id: "own-pace", label: "Learn at your own pace" },
  { id: "expert-lessons", label: "Watch expert-led video lessons" },
  { id: "projects", label: "Build real projects from scratch" },
  { id: "switch", label: "Switch from another platform" },
  { id: "any-device", label: "Learn on any device" },
  { id: "certificates", label: "Earn certificates and badges" },
  { id: "insights", label: "Track progress and gain insights" },
  { id: "library", label: "Manage your learning library" },
  { id: "skills-audit", label: "Test and audit your skills" },
  { id: "mentors", label: "Connect with mentors and community" },
];

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    setUnlocked(isUnlocked());
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-4xl px-6 pb-28 pt-32">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-medium text-violet-400">Admin</p>
          <h1 className="mt-1 font-display text-4xl font-medium tracking-[-0.04em] text-white">
            Content console
          </h1>
        </div>
        {unlocked && (
          <button
            onClick={() => {
              lock();
              setUnlocked(false);
            }}
            className="rounded-lg bg-white/10 px-3.5 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/15"
          >
            Sign out
          </button>
        )}
      </div>

      {unlocked ? (
        <Console />
      ) : (
        <LoginForm onUnlock={() => setUnlocked(true)} />
      )}
    </div>
  );
}

function LoginForm({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  return (
    <div className="mt-10 max-w-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (unlock(value)) onUnlock();
          else setError(true);
        }}
        className="rounded-2xl border border-hairline bg-neutral-950 p-6"
      >
        <label className="text-[13px] font-medium text-neutral-300">
          Admin passcode
        </label>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          placeholder="Enter passcode"
          className="mt-2 w-full rounded-lg border border-white/15 bg-black px-3.5 py-2.5 text-sm text-white placeholder-neutral-600 outline-none focus:border-white/40"
        />
        {error && (
          <p className="mt-2 text-[12px] text-rose-400">
            Incorrect passcode. Try again.
          </p>
        )}
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-white px-3.5 py-2.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-85"
        >
          Sign in
        </button>
      </form>
      <p className="mt-4 text-[12px] leading-relaxed text-neutral-600">
        Demo passcode: <code className="text-neutral-400">kodelab-admin</code>.
        This is a client-side gate for a backend-less demo — replace it with real
        authentication and server storage before production.
      </p>
    </div>
  );
}

function Console() {
  const [config, setConfig] = useState<AdminConfig>({
    showcaseVideos: {},
    customCourses: [],
  });

  useEffect(() => {
    const sync = () => setConfig(loadConfig());
    sync();
    window.addEventListener("kodelab-admin", sync);
    return () => window.removeEventListener("kodelab-admin", sync);
  }, []);

  return (
    <div className="mt-10 space-y-12">
      <FrontPageVideos config={config} />
      <StudyContent config={config} />
    </div>
  );
}

function FrontPageVideos({ config }: { config: AdminConfig }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-white">Front-page videos</h2>
      <p className="mt-1 text-[13px] text-neutral-500">
        Paste a video URL (MP4/WebM) to override the clip shown in each landing
        showcase section. Leave blank to use the default.
      </p>
      <div className="mt-5 space-y-2">
        {showcaseSections.map((s) => (
          <div
            key={s.id}
            className="flex flex-col gap-2 rounded-xl border border-hairline p-4 sm:flex-row sm:items-center"
          >
            <span className="w-56 shrink-0 text-[13px] font-medium text-white">
              {s.label}
            </span>
            <input
              defaultValue={config.showcaseVideos[s.id] ?? ""}
              onBlur={(e) => setShowcaseVideo(s.id, e.target.value)}
              placeholder="https://…/video.mp4"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-[13px] text-white placeholder-neutral-600 outline-none focus:border-white/40"
            />
            {config.showcaseVideos[s.id] && (
              <span className="shrink-0 text-[11px] font-medium text-emerald-400">
                Custom
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const blankLesson = (): CustomLesson => ({
  id: Math.random().toString(36).slice(2, 9),
  title: "",
  duration: "",
  videoUrl: "",
});

function StudyContent({ config }: { config: AdminConfig }) {
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [category, setCategory] = useState(staticCategories[0]);
  const [lessons, setLessons] = useState<CustomLesson[]>([blankLesson()]);

  const slug = useMemo(() => slugify(title), [title]);
  const takenSlugs = useMemo(
    () =>
      new Set([
        ...staticCourses.map((c) => c.slug),
        ...config.customCourses.map((c) => c.slug),
      ]),
    [config.customCourses]
  );

  const validLessons = lessons.filter(
    (l) => l.title.trim() && l.videoUrl.trim()
  );
  const canPublish =
    title.trim().length > 2 && slug && !takenSlugs.has(slug) && validLessons.length > 0;

  const publish = () => {
    if (!canPublish) return;
    const course: CustomCourse = {
      slug,
      title: title.trim(),
      tagline: tagline.trim() || "A course added by the Kodelab team.",
      category,
      lessons: validLessons.map((l) => ({ ...l, duration: l.duration || "—" })),
      createdAt: 0,
    };
    upsertCourse(course);
    setTitle("");
    setTagline("");
    setLessons([blankLesson()]);
  };

  return (
    <section>
      <h2 className="text-lg font-semibold text-white">Study content</h2>
      <p className="mt-1 text-[13px] text-neutral-500">
        Add a course with lesson videos. It appears in the catalog and is
        playable in the study area. (Stored in this browser for the demo.)
      </p>

      {/* Existing custom courses */}
      {config.customCourses.length > 0 && (
        <div className="mt-5 space-y-2">
          {config.customCourses.map((c) => (
            <div
              key={c.slug}
              className="flex items-center gap-3 rounded-xl border border-hairline p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-white">
                  {c.title}
                </p>
                <p className="text-[12px] text-neutral-500">
                  {c.category} · {c.lessons.length} lesson
                  {c.lessons.length === 1 ? "" : "s"}
                </p>
              </div>
              <Link
                href={`/study/${c.slug}`}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/15"
              >
                View
              </Link>
              <button
                onClick={() => deleteCourse(c.slug)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-neutral-500 hover:text-rose-400"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New course form */}
      <div className="mt-6 rounded-2xl border border-hairline bg-neutral-950 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-medium text-neutral-400">Course title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Advanced TypeScript"
              className="mt-1.5 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-[13px] text-white placeholder-neutral-600 outline-none focus:border-white/40"
            />
            {slug && (
              <span
                className={`mt-1 block text-[11px] ${
                  takenSlugs.has(slug) ? "text-rose-400" : "text-neutral-600"
                }`}
              >
                {takenSlugs.has(slug) ? "Slug already in use" : `/courses/${slug}`}
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-neutral-400">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-[13px] text-white outline-none focus:border-white/40"
            >
              {staticCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-4 block">
          <span className="text-[12px] font-medium text-neutral-400">Tagline</span>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="One line describing the course"
            className="mt-1.5 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-[13px] text-white placeholder-neutral-600 outline-none focus:border-white/40"
          />
        </label>

        <div className="mt-6">
          <p className="text-[12px] font-medium text-neutral-400">Lessons</p>
          <div className="mt-2 space-y-2">
            {lessons.map((lesson, i) => (
              <div
                key={lesson.id}
                className="grid gap-2 rounded-xl border border-hairline p-3 sm:grid-cols-[1fr_90px_2fr_auto]"
              >
                <input
                  value={lesson.title}
                  onChange={(e) =>
                    setLessons((ls) =>
                      ls.map((l) =>
                        l.id === lesson.id ? { ...l, title: e.target.value } : l
                      )
                    )
                  }
                  placeholder="Lesson title"
                  className="rounded-lg border border-white/15 bg-black px-3 py-2 text-[13px] text-white placeholder-neutral-600 outline-none focus:border-white/40"
                />
                <input
                  value={lesson.duration}
                  onChange={(e) =>
                    setLessons((ls) =>
                      ls.map((l) =>
                        l.id === lesson.id ? { ...l, duration: e.target.value } : l
                      )
                    )
                  }
                  placeholder="12:00"
                  className="rounded-lg border border-white/15 bg-black px-3 py-2 text-[13px] text-white placeholder-neutral-600 outline-none focus:border-white/40"
                />
                <input
                  value={lesson.videoUrl}
                  onChange={(e) =>
                    setLessons((ls) =>
                      ls.map((l) =>
                        l.id === lesson.id ? { ...l, videoUrl: e.target.value } : l
                      )
                    )
                  }
                  placeholder="https://…/lesson.mp4"
                  className="rounded-lg border border-white/15 bg-black px-3 py-2 text-[13px] text-white placeholder-neutral-600 outline-none focus:border-white/40"
                />
                <button
                  onClick={() =>
                    setLessons((ls) =>
                      ls.length > 1 ? ls.filter((l) => l.id !== lesson.id) : ls
                    )
                  }
                  aria-label="Remove lesson"
                  className="grid place-items-center rounded-lg px-3 text-neutral-500 hover:text-rose-400"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setLessons((ls) => [...ls, blankLesson()])}
            className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/15"
          >
            + Add lesson
          </button>
        </div>

        <button
          onClick={publish}
          disabled={!canPublish}
          className="mt-6 rounded-lg bg-white px-4 py-2.5 text-[12px] font-semibold text-black transition-opacity enabled:hover:opacity-85 disabled:opacity-40"
        >
          Publish course
        </button>
      </div>
    </section>
  );
}
