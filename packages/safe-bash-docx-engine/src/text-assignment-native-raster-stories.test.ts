import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["header", "footer", "comment"] as const) for (const path of ["model", "direct"] as const)
for (const action of ["run-text", "run-clear", "paragraph-text", "paragraph-clear"] as const)
it.concurrent(`destructive native raster text scope remains story-relative; ${dialect}; ${kind}; ${owner}; ${path}; ${action}`, async () => {
  const base = await fixture(dialect, kind, variants[0]!);
  const memory = Volume.fromJSON({ "/input": "", "/output": "", "/destination": "Retained destination" });
  const sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const authored = await api.Document(base, { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z") });
  const story = owner === "header" ? authored.sections[0]!.header : owner === "footer" ? authored.sections[0]!.footer : authored.comments.add_comment("Selected native story");
  const p = story.paragraphs[0]!;
  if (owner !== "comment") p.text = "Selected native story";
  p.alignment = api.WD_ALIGN_PARAGRAPH.RIGHT;
  p.paragraph_format.keep_with_next = true;
  const r = p.runs.at(-1)!; r.bold = true; r.font.rtl = true;
  await r.add_picture(rasterPng());
  const part = p.part.partname.toString();
  await authored.save(sink("/input"));
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input);
  const document = await api.Document(input, textContext), current = owner === "header" ? document.sections[0]!.header : owner === "footer" ? document.sections[0]!.footer : document.comments.get([...authored.comments][0]!.comment_id)!;
  const paragraph = current.paragraphs[0]!, run = paragraph.runs.at(-1)!, text = action.endsWith("clear") ? "" : "Revised native 🌊 עברית 日本";
  if (path === "model") {
    if (action === "run-text") run.text = text; else if (action === "run-clear") run.clear(); else if (action === "paragraph-text") paragraph.text = text; else paragraph.clear();
    if (action.startsWith("run")) { expect(run.bold).toBe(true); expect(run.font.rtl).toBe(true); }
    expect(paragraph.text).toBe(text); expect(paragraph.alignment).toBe(api.WD_ALIGN_PARAGRAPH.RIGHT); expect(paragraph.paragraph_format.keep_with_next).toBe(true);
    await document.save(sink("/output"));
  } else {
    const locations = await api.openDocumentLocations(input, textContext), selected = locations.list(action.startsWith("run") ? "run" : "paragraph", { scope: "all-stories" }).filter(l => l.value.part === part).at(-1)!;
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink("/output") };
    if (action.startsWith("run")) await api.formatDocumentRuns(input, { select: selected.token, text, output: "-" }, context);
    else await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { select: selected.token, text, output: "-" } }, context);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== part.slice(1)) expect(after.get(name), name).toEqual(bytes);
  expect((await api.inspectDocument(output, textContext)).counts.images).toBe(2);
  const reopened = await api.Document(output, textContext), changed = owner === "header" ? reopened.sections[0]!.header : owner === "footer" ? reopened.sections[0]!.footer : reopened.comments.get([...authored.comments][0]!.comment_id)!;
  expect(changed.paragraphs[0]!.text).toBe(text); expect(changed.paragraphs[0]!.alignment).toBe(api.WD_ALIGN_PARAGRAPH.RIGHT); expect(changed.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true);
  if (action.startsWith("run")) { expect(changed.paragraphs[0]!.runs.at(-1)!.bold).toBe(true); expect(changed.paragraphs[0]!.runs.at(-1)!.font.rtl).toBe(true); }
  else for (const value of changed.paragraphs[0]!.runs) { expect(value.bold).toBe(null); expect(value.font.rtl).toBe(null); }
  expect(reopened.paragraphs[0]!.text).toBe("Selected 日本 עברית 🌊"); expect(reopened.paragraphs[1]!.text).toBe("Unselected é海");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.readFileSync("/destination", "utf8")).toBe("Retained destination");
});
