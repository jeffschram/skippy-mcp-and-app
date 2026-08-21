/**
 * Pure autosave logic for the project Notes pad (project-board.tsx). Same
 * treatment as the phase-description editor from the Plan: a debounced
 * autosave while typing, an immediate commit on blur, and a focused-editing
 * guard so reactive (remote) updates never clobber an in-progress edit.
 * Kept free of React/Convex imports so it stays unit-testable.
 */

/** Matches the phase-description editor's keystroke debounce. */
export const PAD_AUTOSAVE_DELAY_MS = 650;

export type PadAutosave = {
  /** Call on textarea focus: enables the focused-editing guard. */
  handleFocus(): void;
  /** Call on every keystroke: schedules a debounced save of `value`. */
  handleChange(value: string): void;
  /** Call on blur: drops the guard and commits `value` immediately if dirty. */
  handleBlur(value: string): void;
  /**
   * Call when the reactive query delivers a new pad value. Returns the value
   * the draft should sync to, or null to keep the local draft (the pad is
   * mid-edit and the remote value must not clobber it).
   */
  remoteValue(value: string): string | null;
  /**
   * Call on component unmount with the latest draft. Flush semantics: if a
   * debounced save is pending and `value` is still dirty, commit it now —
   * React does not reliably fire blur when a focused textarea unmounts (tab
   * switch, route change), so cancelling outright would drop the trailing
   * keystrokes. A clean dispose (no pending debounce) saves nothing, so a
   * blur commit followed by dispose never double-saves.
   */
  dispose(value: string): void;
};

export function createPadAutosave({
  savedValue,
  save,
  delayMs = PAD_AUTOSAVE_DELAY_MS,
}: {
  /** Latest persisted value, read lazily so saves compare against fresh state. */
  savedValue: () => string;
  save: (value: string) => void;
  delayMs?: number;
}): PadAutosave {
  let focused = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    handleFocus() {
      focused = true;
    },
    handleChange(value: string) {
      clearTimer();
      if (value === savedValue()) return;
      timer = setTimeout(() => {
        timer = null;
        // Re-check at fire time: a blur commit (or a remote save landing)
        // may have made this keystroke's save redundant.
        if (value !== savedValue()) save(value);
      }, delayMs);
    },
    handleBlur(value: string) {
      focused = false;
      // The blur commit supersedes any pending debounce — without this the
      // timer would fire after blur and save a stale value.
      clearTimer();
      if (value !== savedValue()) save(value);
    },
    remoteValue(value: string) {
      return focused ? null : value;
    },
    dispose(value: string) {
      // Only a *pending* debounce flushes. If no timer is armed, either the
      // draft is clean or a blur/commit already handled it — saving again
      // here would double-save (or resurrect a stale value).
      const pending = timer !== null;
      clearTimer();
      if (pending && value !== savedValue()) save(value);
    },
  };
}
