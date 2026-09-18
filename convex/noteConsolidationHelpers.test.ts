import { expect, it } from "vitest";
import { consolidatedNoteFields } from "./noteConsolidationHelpers";
import { normalizeAcceptedEntityPayload } from "@skippy/shared";

it("promotes nested text without modifying extra properties", () => {
  const properties = {
    title: "Reference",
    body: "Full original text",
    tags: ["home"],
    sourceSummary: "Source context",
  };
  const row = { properties };
  expect(consolidatedNoteFields(row)).toEqual({
    kind: "note",
    title: "Reference",
    body: "Full original text",
    summary: "Source context",
  });
  expect(row.properties).toBe(properties);
});

it("preserves current canonical text over legacy nested values", () => {
  expect(
    consolidatedNoteFields({
      title: "Edited",
      body: "New text",
      summary: "New summary",
      properties: { title: "Old", body: "Old text" },
    }),
  ).toEqual({
    kind: "note",
    title: "Edited",
    body: "New text",
    summary: "New summary",
  });
});

it("keeps structured note metadata through future normalization", () => {
  const properties = { body: "Original text", warrantyYears: 2 };
  expect(
    normalizeAcceptedEntityPayload("note", {
      title: "Warranty",
      properties,
      objectType: "warranty",
    }),
  ).toMatchObject({
    title: "Warranty",
    body: "Original text",
    properties,
    objectType: "warranty",
  });
});

it("does not replace full text with a shorter summary", () => {
  expect(
    consolidatedNoteFields({
      summary: "Short",
      properties: { body: "Long complete content" },
    }).body,
  ).toBe("Long complete content");
});
