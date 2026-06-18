import { describe, expect, test } from "bun:test";
import { EDIT_TOOL_DESCRIPTION, READ_TOOL_DESCRIPTION, SEARCH_TOOL_DESCRIPTION } from "../src/descriptions.ts";

const allDescriptions = `${READ_TOOL_DESCRIPTION}\n${SEARCH_TOOL_DESCRIPTION}\n${EDIT_TOOL_DESCRIPTION}`;

describe("tool descriptions", () => {
  test("stay compact to reduce coordinator output/input overhead", () => {
    expect(READ_TOOL_DESCRIPTION.length + SEARCH_TOOL_DESCRIPTION.length + EDIT_TOOL_DESCRIPTION.length).toBeLessThanOrEqual(2000);
  });

  test("retain critical hashline usage constraints", () => {
    for (const phrase of [
      "[PATH#TAG]",
      "stale tags are rejected",
      "two dots",
      "tagless header",
      "Built-in Edit/Write tools are disabled",
      "ripgrep",
      "offset/limit",
      "maxResults",
    ]) {
      expect(allDescriptions).toContain(phrase);
    }
  });
});
