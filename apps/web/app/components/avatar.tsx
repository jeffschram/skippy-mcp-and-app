"use client";

import { useEffect, useState } from "react";

export const AVATAR_FRAME_RATE = 4;

export const avatarStates = [
  {
    "name": "smile",
    "frames": [
      " •‿• "
    ]
  },
  {
    "name": "default",
    "frames": [
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " •_• ",
      " -_- "
    ]
  },
  {
    "name": "talking",
    "frames": [
      " •_• ",
      " •▁• ",
      " •▂• ",
      " •▁• "
    ]
  },
  {
    "name": "surprised",
    "frames": [
      " ◉▁◉ ",
      " ◉▁◉ ",
      " ◉▁◉ ",
      " ◉▁◉ ",
      " ◉▁◉ ",
      " ◉。◉ ",
      " ◉。◉ ",
      " ◉。◉ "
    ]
  },
  {
    "name": "wink",
    "frames": [
      " •‿• ",
      " •‿• ",
      " •‿• ",
      " •‿• ",
      " •‿- "
    ]
  },
  {
    "name": "sleeping",
    "frames": [
      " -_- ",
      " -_- ",
      " -_- ",
      " -_- ",
      " -_- ",
      " -_- ",
      " -_- ",
      " -_-z",
      " -_-zz",
      " -_-zzz",
      " -_-zzz",
      " -_- zz",
      " -_-  z"
    ]
  },
  {
    "name": "searching",
    "frames": [
      " ◐_◐ ",
      " ◐_◐ ",
      " ◐_◐ ",
      " ◐_◐ ",
      " ◑_◑ ",
      " ◑_◑ ",
      " ◑_◑ ",
      " ◑_◑ "
    ]
  },
  {
    "name": "proud",
    "frames": [
      "ᕙ•ᴗ•ᕗ"
    ]
  },
  {
    "name": "celebrate",
    "frames": [
      "\\^‿^/"
    ]
  },
  {
    "name": "disagree",
    "frames": [
      " ˘︹˘ "
    ]
  }
] as const;

export type AvatarStateName = (typeof avatarStates)[number]["name"];

type AvatarProps = {
  state?: AvatarStateName;
  frameRate?: number;
  className?: string;
};

/**
 * Skippy's text avatar. It currently exercises the default animation; state
 * selection can layer onto the same component without changing its composer
 * placement.
 */
export function Avatar({ state: stateName = "default", frameRate = AVATAR_FRAME_RATE, className }: AvatarProps) {
  const state = avatarStates.find((candidate) => candidate.name === stateName) ?? avatarStates[0];
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    if (state.frames.length <= 1) return;

    const intervalId = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % state.frames.length);
    }, 1000 / frameRate);

    return () => window.clearInterval(intervalId);
  }, [frameRate, state]);

  const frame = state.frames[frameIndex] ?? state.frames[0];

  return (
    <span
      className={className}
      role="img"
      aria-label={`Skippy is ${state.name}`}
      title={`Skippy: ${state.name}`}
    >
      {frame}
    </span>
  );
}
