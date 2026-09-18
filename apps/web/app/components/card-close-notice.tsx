"use client";
import { useEffect, useRef, useState } from "react";
import { startCardCloseCountdown } from "../../lib/card-close";
export function CardCloseNotice({ completed, ready, typing, onClose }: { completed: boolean; ready: boolean; typing: boolean; onClose: () => void }) {
  const [keptOpen, setKeptOpen] = useState(false);
  const [seconds, setSeconds] = useState(5);
  const callback = useRef(onClose);
  useEffect(() => { callback.current = onClose; }, [onClose]);
  useEffect(() => { if (completed && typing) setKeptOpen(true); }, [completed, typing]);
  useEffect(() => {
    if (!ready || typing || keptOpen) return;
    return startCardCloseCountdown(setSeconds, () => callback.current());
  }, [ready, typing, keptOpen]);
  if (!ready || typing || keptOpen) return null;
  return <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-2 text-xs text-[var(--mind-muted)]">
    <span role="status">Task completed · Closing in {seconds}s</span>
    <button type="button" className="shrink-0 rounded px-2 py-1 text-[var(--mind-accent)] hover:bg-[var(--mind-surface)] focus-visible:outline" onClick={() => setKeptOpen(true)}>Keep open</button>
  </div>;
}
