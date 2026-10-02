import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { admitFontMetrics, fitTextFrames, TextFrame } from "./index.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { validateTextFitOptions, type FitTextFramesOptions } from "./text-fitting.js";
import { parseXmlPart } from "./xml.js";

const metricData = {
  family: "Calibri",
  bold: false,
  italic: false,
  unitsPerEm: 10,
  lineHeight: 10,
  advances: { A: 5 }
};
const metrics = admitFontMetrics(metricData);
const context = {
  limits: { maxBytes: 8192, maxReads: 100, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 100, maxDepth: 16 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 }
};
const fields = ["fontFamily", "maxSize", "minSize", "bold", "italic", "lineSpacing"] as const;

it.each(fields)("rejects explicit null %s before admitting document bytes", async (key) => {
  const options = { metrics, all: true, [key]: null } as unknown as FitTextFramesOptions;
  expect(() => validateTextFitOptions(options)).toThrowError(
    expect.objectContaining({ code: "invalid-value", phase: "usage" })
  );
  await expect(fitTextFrames(new Uint8Array(), options, context)).rejects.toMatchObject({
    code: "invalid-value",
    phase: "usage"
  });
});

it.each(fields)("retains undefined %s defaults", (key) => {
  expect(() => validateTextFitOptions({ metrics, [key]: undefined })).not.toThrow();
});

it("rejects null in the command schema and invalid numeric flags before memfs reads", async () => {
  const fs = Volume.fromJSON({ "/deck": "unread input" });
  const readInput = vi.fn(async (path: string) => new Uint8Array(fs.readFileSync(path) as Buffer));
  const publishOutput = vi.fn(async () => {});
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 8192,
    maxOutputBytes: 65536
  });
  const run = (args: string[]) =>
    engine.execute({
      args: args.map((value) => new TextEncoder().encode(value)),
      signal: new AbortController().signal,
      readInput,
      publishOutput
    });
  const schemaResult = await run(["schema", "text", "fit", "--json"]);
  expect(schemaResult.exitCode).toBe(0);
  const options = JSON.parse(new TextDecoder().decode(schemaResult.stdout)).data.operations[
    "text.fit"
  ].options;
  const validator = compileJsonSchema(options);
  for (const key of fields) {
    expect(validator.validate({ metrics: metricData, all: true, [key]: null }).ok).toBe(false);
  }
  for (const flag of ["--min-size", "--max-size", "--line-spacing"]) {
    const result = await run([
      "text",
      "fit",
      "/deck",
      "--all",
      "--metrics",
      JSON.stringify(metricData),
      flag,
      "null",
      "--dry-run",
      "--json"
    ]);
    expect(result.exitCode).toBe(2);
  }
  expect(readInput).not.toHaveBeenCalled();
  expect(publishOutput).not.toHaveBeenCalled();
});

it("fits the exact nondefault minimum and rejects a one-point increase without mutation", () => {
  const xml = parseXmlPart(
    new TextEncoder().encode(
      '<a:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:p><a:r><a:t>AA</a:t></a:r></a:p></a:txBody>'
    ),
    context.xmlLimits
  );
  const frame = new TextFrame(xml, { width: 13, height: 26 });
  frame.fit_text(undefined, 30, false, false, metrics, { minSize: 13, lineSpacing: 2 });
  const run = frame.paragraphs[0]!.runs[0]!;
  expect(run.font.size?.pt).toBe(13);
  expect(frame.text).toBe("AA");
  const before = frame.xml;
  expect(() =>
    frame.fit_text(undefined, 30, false, false, metrics, { minSize: 14, lineSpacing: 2 })
  ).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
  expect(frame.xml).toBe(before);
});
