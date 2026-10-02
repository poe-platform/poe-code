import assert from "node:assert/strict";
import { it } from "node:test";
import { runSofficeCli } from "./index.js";

it("skips nested RTF metadata and preserves paragraph and line controls after formatting", async () => {
  const source = String.raw`{\rtf1\ansi{\fonttbl{\f0\froman Times New Roman;}{\f1\fswiss Arial;}}{\info{\title Hidden title}}{\*\unknown Hidden destination}First \i line\i0\par Second line.\b0\line Third\tab cell.}`;
  const files = new Map([["/source.rtf", new TextEncoder().encode(source)]]);
  const cat = await runSofficeCli(["--cat", "/source.rtf"], files);
  assert.equal(cat.exitCode, 0, cat.stderr);
  assert.equal(cat.stdout, "First line\nSecond line.\nThird\tcell.\n");
  const result = await runSofficeCli(["--convert-to", "txt", "/source.rtf"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(files.get("/source.txt")), "First line\n\nSecond line.\n\nThird\tcell.\n");
});

it("preserves escaped RTF braces, backslashes and hex text without treating source newlines as paragraphs", async () => {
  const source = "{\\rtf1 A\\{brace\\} and \\\\ path \\'e9\ncontinued\\par End}";
  const result = await runSofficeCli(["--cat", "/source.rtf"], new Map([["/source.rtf", new TextEncoder().encode(source)]]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "A{brace} and \\ path écontinued\nEnd\n");
});
