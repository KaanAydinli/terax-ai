import { describe, expect, it } from "vitest";
import { resolveLanguage, resolveLanguageSync } from "./languageResolver";

describe("languageResolver", () => {
  it("uses JSON highlighting for jsonl files", async () => {
    expect(resolveLanguageSync("events.jsonl")).toBeNull();

    const extension = await resolveLanguage("events.jsonl");

    expect(extension).not.toBeNull();
    expect(resolveLanguageSync("/tmp/events.jsonl")).toBe(extension);
  });
});
