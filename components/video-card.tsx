"use client";

import { useRef, useState } from "react";

export default function VideoCard({
  src,
  className = "",
}: {
  src: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-2xl bg-neutral-900 ${className}`}
      onClick={toggle}
    >
      <video
        ref={ref}
        src={src}
        preload="metadata"
        playsInline
        onEnded={() => setPlaying(false)}
        className="h-full w-full object-cover"
      />
      {!playing && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/60 backdrop-blur transition-transform group-hover:scale-110">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
              <path d="M6 4.5v11l9-5.5-9-5.5z" />
            </svg>
          </span>
        </span>
      )}
    </div>
  );
}
