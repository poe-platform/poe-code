import {expect, it} from "vitest";
import {writeDocument} from "./engine.js";

it("ends a LaTeX prose fragment with exactly one newline", async () => {
  expect(await writeDocument({blocks: [{t: "Para", c: [{t: "Str", c: "Matrix"}]}], metadata: {}, resources: []},
    {to: "latex"}, {})).toMatchObject({kind: "text", text: "Matrix\n"});
});

it("preserves internal paragraph separators and literal code newlines", async () => {
  expect(await writeDocument({blocks: [
    {t: "Para", c: [{t: "Str", c: "First"}]},
    {t: "CodeBlock", c: [["", [], []], "one\n\n"]},
    {t: "Para", c: [{t: "Str", c: "Last"}]}
  ], metadata: {}, resources: []}, {to: "latex"}, {})).toMatchObject({kind: "text",
    text: "First\n\n\\begin{flushleft}\\ttfamily\n\\mbox{one}\\\\\n\\mbox{}\\\\\n\\mbox{}\\\\\n\\end{flushleft}\n\nLast\n"});
});
