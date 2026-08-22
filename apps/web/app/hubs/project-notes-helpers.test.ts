import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAD_AUTOSAVE_DELAY_MS, createPadAutosave } from "./project-notes-helpers";

function setup(initialSaved = "") {
  let saved = initialSaved;
  const saves: string[] = [];
  const pad = createPadAutosave({
    savedValue: () => saved,
    save: (value) => {
      saves.push(value);
      saved = value;
    },
  });
  return { pad, saves, setSaved: (value: string) => (saved = value) };
}

describe("project notes pad autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces keystrokes into a single save of the latest value", () => {
    const { pad, saves } = setup();

    pad.handleFocus();
    pad.handleChange("d");
    pad.handleChange("dr");
    pad.handleChange("drop thoughts");
    expect(saves).toEqual([]);

    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS);
    expect(saves).toEqual(["drop thoughts"]);
  });

  it("does not save when the value matches what is already persisted", () => {
    const { pad, saves } = setup("unchanged");

    pad.handleChange("unchanged");
    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS);
    pad.handleBlur("unchanged");

    expect(saves).toEqual([]);
  });

  it("typing back to the saved value cancels the pending save", () => {
    const { pad, saves } = setup("original");

    pad.handleChange("original edited");
    pad.handleChange("original");
    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS);

    expect(saves).toEqual([]);
  });

  it("blur commits immediately and supersedes the pending debounce", () => {
    const { pad, saves } = setup();

    pad.handleFocus();
    pad.handleChange("half a thou");
    pad.handleBlur("half a thought");
    expect(saves).toEqual(["half a thought"]);

    // The debounced keystroke save must not fire afterwards with stale text.
    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS * 2);
    expect(saves).toEqual(["half a thought"]);
  });

  it("skips a debounced save that became redundant by the time it fires", () => {
    const { pad, saves, setSaved } = setup();

    pad.handleChange("same idea");
    // e.g. another surface saved identical text meanwhile (last-write-wins).
    setSaved("same idea");
    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS);

    expect(saves).toEqual([]);
  });

  it("guards the draft from remote updates only while focused", () => {
    const { pad } = setup();

    // Idle: reactive updates flow into the draft (other-device sync).
    expect(pad.remoteValue("from the phone")).toBe("from the phone");

    // Mid-edit: keep the local draft, never clobber an in-focus edit.
    pad.handleFocus();
    expect(pad.remoteValue("remote overwrite")).toBeNull();

    // Blur drops the guard again.
    pad.handleBlur("local text");
    expect(pad.remoteValue("post-blur remote")).toBe("post-blur remote");
  });

  it("dispose flushes a pending dirty edit exactly once (unmount mid-debounce)", () => {
    const { pad, saves } = setup();

    pad.handleFocus();
    pad.handleChange("about to unmount");
    pad.dispose("about to unmount");
    expect(saves).toEqual(["about to unmount"]);

    // The cancelled debounce must not fire a second save afterwards.
    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS * 2);
    expect(saves).toEqual(["about to unmount"]);
  });

  it("dispose flushes the latest draft, not the value the debounce captured", () => {
    const { pad, saves } = setup();

    pad.handleChange("first keystro");
    pad.handleChange("first keystrokes");
    pad.dispose("first keystrokes");

    expect(saves).toEqual(["first keystrokes"]);
  });

  it("clean dispose saves nothing", () => {
    const { pad, saves } = setup("resting value");

    // No pending debounce, value matches persisted state: a no-op unmount.
    pad.dispose("resting value");
    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS * 2);
    expect(saves).toEqual([]);
  });

  it("dispose without a pending debounce saves nothing even if handed a dirty value", () => {
    const { pad, saves } = setup("persisted");

    // Nothing was ever scheduled (e.g. blur already committed and cleared the
    // timer); dispose must not fire a speculative save of its own.
    pad.dispose("persisted plus unscheduled text");
    expect(saves).toEqual([]);
  });

  it("blur-then-dispose does not double-save", () => {
    const { pad, saves } = setup();

    pad.handleFocus();
    pad.handleChange("committed at blu");
    pad.handleBlur("committed at blur");
    expect(saves).toEqual(["committed at blur"]);

    pad.dispose("committed at blur");
    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS * 2);
    expect(saves).toEqual(["committed at blur"]);
  });

  it("dispose skips the flush when the pending value became redundant", () => {
    const { pad, saves, setSaved } = setup();

    pad.handleChange("same idea");
    // Another surface persisted identical text meanwhile (last-write-wins).
    setSaved("same idea");
    pad.dispose("same idea");

    expect(saves).toEqual([]);
  });
});
