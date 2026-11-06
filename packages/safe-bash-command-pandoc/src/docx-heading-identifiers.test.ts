import "safe-bash-docx-engine";
import {expect, it} from "vitest";
import {convert} from "./engine.js";

it.each([
  ["# Heading\n\n## Heading\n\n# Heading-1\n\n# Heading\n", ["heading", "heading-1", "heading-1-1", "heading-2"]],
  ["# 33. *Hello*, [World](/url) `A_B.C`!\n\n# 123 !!!\n\n# École 中文\n\n# !!!\n", ["hello-world-a_b.c", "section", "école-中文", "section-1"]],
] as const)("assigns native DOCX heading identifiers: %s", async (markdown, identifiers) => {
  const input = [{bytes: new TextEncoder().encode(markdown)}];
  const docx = await convert(input, {from: "markdown", to: "docx"}, {});
  if (docx.kind !== "binary") throw new Error("Expected DOCX");
  // Repeated reads must allocate identifiers independently.
  for (let read = 0; read < 2; read++) {
    const result = await convert([{bytes: docx.bytes}], {from: "docx", to: "json"}, {});
    if (result.kind !== "text") throw new Error("Expected JSON");
    expect(JSON.parse(result.text).blocks.map((block: {c: [number, [string]]}) => block.c[1][0])).toEqual(identifiers);
  }
  const html = await convert([{bytes: docx.bytes}], {from: "docx", to: "html"}, {});
  expect(html).toEqual(await convert(input, {from: "markdown", to: "html"}, {}));
});
