import { describe, expect, it } from "vitest";
import {
  normalizedTaskMatchText,
  selectTaskDuplicate,
  taskTitleLooksDuplicate,
  type DuplicateTaskCandidate,
} from "./index";

/* ------------------------------------------------------------------ */
/* Task duplicate detection                                            */
/*                                                                     */
/* Regression coverage for a silent failure observed live: three        */
/* near-identical tasks all reached the agenda because the duplicate    */
/* scan was capped at 300 rows off an oldest-first index, so every task */
/* created past that cap stopped being compared against anything.       */
/* ------------------------------------------------------------------ */

function candidate(id: string, title: string, createdAt = 0): DuplicateTaskCandidate {
  return { _id: id, title, _creationTime: createdAt };
}

describe("normalizedTaskMatchText", () => {
  it("reduces a title to comparable words", () => {
    expect(normalizedTaskMatchText("Fix Acuity cookie issue on studioandreas.com")).toBe(
      "fix acuity cookie issue on studioandreas com",
    );
  });

  it("drops filler verbs captures habitually add", () => {
    expect(normalizedTaskMatchText("Review and track the invoice")).toBe("invoice");
  });

  it("does not chew words that merely contain a stopword", () => {
    // "studioandreas" contains "and"; stripping it would wreck the match.
    expect(normalizedTaskMatchText("studioandreas.com")).toBe("studioandreas com");
  });

  it("handles empty and missing input", () => {
    expect(normalizedTaskMatchText(undefined)).toBe("");
    expect(normalizedTaskMatchText("   ")).toBe("");
  });
});

describe("taskTitleLooksDuplicate", () => {
  it("matches the real-world pair that reached production", () => {
    expect(
      taskTitleLooksDuplicate(
        "Fix Acuity cookie issue on studioandreas.com",
        "Fix cookie issue on studioandreas.com",
      ),
    ).toBe(true);
  });

  it("matches on containment", () => {
    expect(taskTitleLooksDuplicate("Pay Optimum bill", "Pay Optimum bill — $84")).toBe(true);
  });

  it("keeps genuinely different work apart", () => {
    expect(taskTitleLooksDuplicate("Pay Optimum bill", "Call the dentist")).toBe(false);
    expect(taskTitleLooksDuplicate("Renew passport", "Renew car registration")).toBe(false);
  });

  it("never matches an empty title", () => {
    expect(taskTitleLooksDuplicate("", "Pay Optimum bill")).toBe(false);
  });

  // Numbers are identifiers. Found live: these two would have merged on word
  // overlap alone, destroying one of two genuinely different review tasks.
  it("keeps items apart when their identifying numbers disagree", () => {
    expect(
      taskTitleLooksDuplicate(
        "Review Vercel comment on iamfranz PR #13 nav links",
        "Review Vercel comment on iamfranz PR #11 deploy fix",
      ),
    ).toBe(false);
  });

  it("is not fooled by one number being a substring of another", () => {
    expect(taskTitleLooksDuplicate("Pay invoice 100", "Pay invoice 1000")).toBe(false);
  });

  it("still merges when the numbers agree", () => {
    expect(taskTitleLooksDuplicate("Optimum bill $84 due", "Pay Optimum bill — $84")).toBe(true);
  });

  it("still merges when one side simply omits the number", () => {
    expect(taskTitleLooksDuplicate("Pay Optimum bill", "Pay Optimum bill — $84")).toBe(true);
  });

  it("allows one number set to extend the other", () => {
    // Same bill, one title carries an extra due-date detail.
    expect(taskTitleLooksDuplicate("Pay bill 84 due 15", "Pay bill 84")).toBe(true);
  });

  it("is symmetric", () => {
    const a = "Fix Acuity cookie issue on studioandreas.com";
    const b = "Fix cookie issue on studioandreas.com";
    expect(taskTitleLooksDuplicate(a, b)).toBe(taskTitleLooksDuplicate(b, a));
  });
});

describe("selectTaskDuplicate", () => {
  it("finds a match at the front of the candidate list", () => {
    const found = selectTaskDuplicate(
      [candidate("t1", "Fix cookie issue on studioandreas.com")],
      { title: "Fix Acuity cookie issue on studioandreas.com" },
    );

    expect(found?._id).toBe("t1");
  });

  // THE regression. The old implementation scanned a bounded, oldest-first
  // slice, so a duplicate sitting past the cap was invisible — which is exactly
  // where freshly captured tasks land. Position must never decide the outcome.
  it("finds a match no matter how deep in the candidate list it sits", () => {
    const filler = Array.from({ length: 400 }, (_, i) =>
      candidate(`filler_${i}`, `Unrelated errand number ${i}`),
    );
    const candidates = [...filler, candidate("late", "Fix cookie issue on studioandreas.com")];

    const found = selectTaskDuplicate(candidates, {
      title: "Fix Acuity cookie issue on studioandreas.com",
    });

    expect(found?._id).toBe("late");
  });

  it("returns null when nothing matches", () => {
    expect(
      selectTaskDuplicate([candidate("t1", "Call the dentist")], { title: "Pay Optimum bill" }),
    ).toBeNull();
  });

  it("returns null for an empty candidate set", () => {
    expect(selectTaskDuplicate([], { title: "Pay Optimum bill" })).toBeNull();
  });

  it("prefers the first candidate given, so callers control precedence by order", () => {
    const found = selectTaskDuplicate(
      [
        candidate("newer", "Fix cookie issue on studioandreas.com", 200),
        candidate("older", "Fix cookie issue on studioandreas.com", 100),
      ],
      { title: "Fix Acuity cookie issue on studioandreas.com" },
    );

    expect(found?._id).toBe("newer");
  });

  describe("project scoping", () => {
    const projectIdByTaskId = new Map([["project_task", "project_1"]]);

    it("refuses to merge a project-less task into a project task", () => {
      const found = selectTaskDuplicate(
        [candidate("project_task", "Call the dentist")],
        { title: "Call the dentist" },
        projectIdByTaskId,
      );

      expect(found).toBeNull();
    });

    it("merges within the same project", () => {
      const found = selectTaskDuplicate(
        [candidate("project_task", "Call the dentist")],
        { title: "Call the dentist", projectId: "project_1" },
        projectIdByTaskId,
      );

      expect(found?._id).toBe("project_task");
    });

    it("skips a scope mismatch to reach a valid match further down", () => {
      const found = selectTaskDuplicate(
        [
          candidate("project_task", "Call the dentist"),
          candidate("life_task", "Call the dentist"),
        ],
        { title: "Call the dentist" },
        projectIdByTaskId,
      );

      expect(found?._id).toBe("life_task");
    });
  });
});
