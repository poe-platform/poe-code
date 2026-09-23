import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, RGBColor, applyStyleModelBatch, createDocxInspectionCommandEngine } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const invalid = [
  ["missing", undefined], ["null", null], ["string", "10"],
  ["object", {}], ["array", []], ["NaN", Number.NaN],
  ["positive infinity", Number.POSITIVE_INFINITY], ["negative infinity", Number.NEGATIVE_INFINITY]
] as const;

for (const strict of [false, true]) for (const member of ["count", "index", "includes"] as const)
 for (const [label, value] of invalid) for (const route of ["model", "sdk", "cli"] as const)
 it(`${route} rejects ${label} required RGB ${member} search argument; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:color w:val="0A200A"/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', {}, strict);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "Original destination" });
  const bytes = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const field = member === "includes" ? "channel" : "value";
  const operations = [
    { operation: "model.shared.RGBColor.from_string.call", arguments: { rgbHexStr: "0A200A" }, resultHandle: "rgb" },
    { operation: `model.shared.RGBColor.${member === "includes" ? "__contains__" : member}.call`, receiver: { resultHandle: "rgb" }, arguments: value === undefined ? {} : { [field]: value } }
  ];
  if (route === "model") {
    const document = await Document(bytes, textContext), color = document.paragraphs[0]!.runs[0]!.font.color.rgb!;
    expect(() => color[member](value as number)).toThrow(TypeError);
    expect(color.toArray()).toEqual([10, 32, 10]);
    expect(document.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊");
  } else if (route === "sdk") {
    await expect(applyStyleModelBatch(bytes, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "usage" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", bytes); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      // JSON has no nonfinite numbers: use their literal invalid JSON tokens so
      // CLI admission is exercised without relabeling null as the original value.
      const json = JSON.stringify({ version: 1, operations });
      const encoded = typeof value === "number" && !Number.isFinite(value)
        ? json.replace(`"${field}":null`, `"${field}":${String(value)}`) : json;
      const result = await shell.exec(`docx batch /input --ops-json '${encoded}' --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(2);
      expect(JSON.parse(result.stdout).errors[0].code).toBe("usage");
      expect(await fs.readFile("/input")).toEqual(bytes);
      expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  expect(memory.readFileSync("/out", "utf8")).toBe("Original destination");
 });

it("retains numeric RGB search values, duplicates and bounded index semantics", () => {
  const color = new RGBColor(10, 32, 10);
  expect(color.count(10)).toBe(2); expect(color.count(10.5)).toBe(0);
  expect(color.includes(10)).toBe(true); expect(color.includes(10.5)).toBe(false);
  expect(color.index(10)).toBe(0); expect(color.index(10, 1)).toBe(2);
  expect(color.index(10, -1)).toBe(2);
  expect(() => color.index(10, 1, 2)).toThrow(RangeError);
  expect(() => color.index(10.5)).toThrow(RangeError);
  expect(color.toArray()).toEqual([10, 32, 10]);
});
