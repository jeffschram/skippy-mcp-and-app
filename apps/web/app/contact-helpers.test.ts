import { describe, expect, it } from "vitest";
import { contactDetailFields, contactMetaLabel } from "./contact-helpers";

describe("contactMetaLabel", () => {
  it("prefers relationship context, then notes, then domain", () => {
    expect(contactMetaLabel({ relationshipContext: "Met at ConvexConf", notes: "n", domain: "d" })).toBe(
      "Met at ConvexConf",
    );
    expect(contactMetaLabel({ notes: "Old coworker", domain: "acme.com" })).toBe("Old coworker");
    expect(contactMetaLabel({ domain: "acme.com" })).toBe("acme.com");
  });

  it("skips blank/whitespace values instead of rendering an empty line", () => {
    expect(contactMetaLabel({ relationshipContext: "   ", notes: "Old coworker" })).toBe("Old coworker");
    expect(contactMetaLabel({ relationshipContext: "", notes: "  ", domain: "" })).toBe("Accepted");
  });

  it("falls back to 'Accepted' when nothing is populated", () => {
    expect(contactMetaLabel({})).toBe("Accepted");
  });
});

describe("contactDetailFields", () => {
  it("returns only populated fields, long-form context first", () => {
    expect(
      contactDetailFields({
        relationshipContext: "Met at ConvexConf",
        roleTitle: "CTO",
        emails: ["a@example.com", "b@example.com"],
        notes: "",
      }),
    ).toEqual([
      { label: "Context", value: "Met at ConvexConf" },
      { label: "Role", value: "CTO" },
      { label: "Email", value: "a@example.com, b@example.com" },
    ]);
  });

  it("handles company-shaped records", () => {
    expect(
      contactDetailFields({ relationshipLabel: "client", website: "https://acme.com", domain: "acme.com" }),
    ).toEqual([
      { label: "Relationship", value: "client" },
      { label: "Website", value: "https://acme.com" },
      { label: "Domain", value: "acme.com" },
    ]);
  });

  it("drops empty arrays, blank entries, and non-string values", () => {
    expect(
      contactDetailFields({
        emails: [],
        phoneNumbers: ["  ", ""],
        addresses: [42, "1 Main St"] as unknown[],
        roleTitle: 7,
      }),
    ).toEqual([{ label: "Address", value: "1 Main St" }]);
  });

  it("returns an empty list for a bare record", () => {
    expect(contactDetailFields({})).toEqual([]);
  });
});
