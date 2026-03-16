import test from "node:test";
import assert from "node:assert/strict";
import { replaceSelectionInMarkdown } from "./text-selection.js";

test("replaceSelectionInMarkdown falls back to the nearest matching span when rendered offsets include extra block whitespace", () => {
  const source = [
    "## Outline",
    "- I stopped writing code. I stopped using IDEs.",
    "",
    "## LinkedIn",
    "",
    "I stopped writing code again.",
  ].join("\n");

  const next = replaceSelectionInMarkdown(source, {
    anchorText: "I stopped",
    anchorStart: 9,
    anchorEnd: 18,
    replacementText: "We stopped",
  });

  assert.ok(next);
  assert.match(next ?? "", /- We stopped writing code\. I stopped using IDEs\./);
  assert.match(next ?? "", /I stopped writing code again\./);
});

test("replaceSelectionInMarkdown picks the closest duplicate match", () => {
  const source = [
    "## Outline",
    "- I stopped writing code.",
    "",
    "## Twitter",
    "",
    "I stopped writing code too.",
  ].join("\n");

  const next = replaceSelectionInMarkdown(source, {
    anchorText: "I stopped",
    anchorStart: 33,
    anchorEnd: 42,
    replacementText: "We stopped",
  });

  assert.ok(next);
  assert.match(next ?? "", /- I stopped writing code\./);
  assert.match(next ?? "", /We stopped writing code too\./);
});
