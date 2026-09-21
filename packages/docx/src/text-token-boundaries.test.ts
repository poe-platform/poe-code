import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine } from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";

it.each([
  { token: "noBreakHyphen", text: "-" },
  { token: "ptab", text: "\t" }
])("replaces and clears a stored $token text token while retaining explicit false font state", async ({ token, text }) => {
  const bytes = await textFixture(`<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:${token}/></w:r></w:p>`);
  const volume = Volume.fromJSON({ "/input": Buffer.from(bytes), "/saved": "" });
  const document = await Document(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
  const run = document.paragraphs[0]!.runs[0]!;
  expect(run.text).toBe(text);
  run.text = "海岸 🌊";
  expect(run.text).toBe("海岸 🌊");
  expect(run.bold).toBe(false);
  expect(run.element.children.map(child => child.tag.localName)).toEqual(["rPr", "t"]);
  expect(run.clear()).toBe(run);
  expect(run.text).toBe("");
  expect(run.bold).toBe(false);
  expect(run.element.children.map(child => child.tag.localName)).toEqual(["rPr"]);
  await document.save({ async write(chunk) { volume.appendFileSync("/saved", chunk); } });
  const reopened = await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer), textContext);
  expect(reopened.paragraphs[0]!.runs[0]!.bold).toBe(false);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(bytes));
});

it.each(["noBreakHyphen", "ptab"])("replaces %s through the declared SDK-backed CLI batch", async token => {
  const bytes = await textFixture(`<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:${token}/></w:r></w:p>`);
  const volume = Volume.fromJSON({ "/input": Buffer.from(bytes), "/output": "", "/err": "" });
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.text.set", receiver: { resultHandle: "runs", index: 0 }, arguments: { value: "海岸 🌊" } }
  ];
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations }), "--output", "-"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { volume.appendFileSync("/output", chunk); } },
    stderr: { async write(chunk) { volume.appendFileSync("/err", chunk); } }
  });
  expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  const reopened = await Document(new Uint8Array(volume.readFileSync("/output") as Buffer), textContext);
  const run = reopened.paragraphs[0]!.runs[0]!;
  expect(run.text).toBe("海岸 🌊");
  expect(run.bold).toBe(false);
  expect(new TextDecoder().decode(run.element.serialize())).toBe(`<w:r xmlns:w="${w}" xmlns:r="${r}" xmlns:pi="${w}"><w:rPr><w:b w:val="0"/></w:rPr><pi:t xml:space="preserve">海岸 🌊</pi:t></w:r>`);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(bytes));
});

it.each([
  { token: "noBreakHyphen", text: "-" },
  { token: "ptab", text: "\t" }
])("retains a $token-only cached-break fragment on either side", async ({ token, text }) => {
  const document = await Document(await textFixture(`<w:p><w:r><w:${token}/><w:lastRenderedPageBreak/><w:${token}/></w:r></w:p>`), textContext);
  const paragraph = document.paragraphs[0]!;
  const before = new TextDecoder().decode(paragraph.element.serialize());
  const marker = paragraph.rendered_page_breaks[0]!;
  expect(marker.preceding_paragraph_fragment?.text).toBe(text);
  expect(marker.following_paragraph_fragment?.text).toBe(text);
  const expected = `<w:p xmlns:bm="${w}" xmlns:w="${w}" xmlns:r="${r}"><w:r xmlns:w="${w}" xmlns:r="${r}"><w:${token}/></w:r></w:p>`;
  for (const fragment of [marker.preceding_paragraph_fragment, marker.following_paragraph_fragment]) {
    expect(new TextDecoder().decode(fragment!.element.serialize())).toBe(expected);
  }
  expect(new TextDecoder().decode(paragraph.element.serialize())).toBe(before);
});
