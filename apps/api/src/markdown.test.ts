import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./markdown.js";

test("renderMarkdown preserves CommonMark-style paragraph and hard-break behavior", async () => {
  const html = await renderMarkdown(
    [
      "first line",
      "second line",
      "",
      "new paragraph  ",
      "hard break line",
    ].join("\r\n"),
  );

  assert.match(html, /<p>first line\s+second line<\/p>/);
  assert.match(html, /<p>new paragraph<br>\nhard break line<\/p>/);
});

test("renderMarkdown opens links in a new tab safely", async () => {
  const html = await renderMarkdown("[OpenAI](https://openai.com)");

  assert.match(html, /<a[^>]*href="https:\/\/openai\.com\/?"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>OpenAI<\/a>/);
});
