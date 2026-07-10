"use client";

import { useEffect, useState } from "react";
import { isStoredVideo, newVideoId, putVideo } from "@/lib/videoStore";

/**
 * Video source field: type a URL or upload a file. On upload, the file is
 * stored in IndexedDB and the value becomes "idb:<id>". Calls onChange with
 * the final value (URL or idb ref).
 */
export default function VideoInput({
  value,
  onChange,
  placeholder = "https://…/video.mp4",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const stored = isStoredVideo(value);

  useEffect(() => {
    if (!isStoredVideo(value)) setText(value);
  }, [value]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const id = newVideoId();
      await putVideo(id, file);
      onChange(`idb:${id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {stored ? (
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
          <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0">
            <path d="M4 9.5l3 3 7-7" />
          </svg>
          Uploaded video
        </span>
      ) : (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onChange(text)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-[13px] text-white placeholder-neutral-600 outline-none focus:border-white/40"
        />
      )}

      <label
        className={`shrink-0 cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-white/15 ${
          busy ? "opacity-60" : ""
        }`}
      >
        {busy ? "Uploading…" : stored ? "Replace" : "Upload"}
        <input
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
      </label>

      {stored && (
        <button
          type="button"
          onClick={() => {
            setText("");
            onChange("");
          }}
          aria-label="Remove uploaded video"
          className="shrink-0 rounded-lg px-2 py-2 text-[13px] text-neutral-500 hover:text-rose-400"
        >
          ✕
        </button>
      )}
    </div>
  );
}
