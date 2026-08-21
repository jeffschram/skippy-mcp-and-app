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

  it("dispose cancels a pending save (unmount mid-debounce)", () => {
    const { pad, saves } = setup();

    pad.handleChange("about to unmount");
    pad.dispose();
    vi.advanceTimersByTime(PAD_AUTOSAVE_DELAY_MS * 2);

    expect(saves).toEqual([]);
  });
});
