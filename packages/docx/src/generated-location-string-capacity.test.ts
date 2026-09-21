import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import * as tokens from "./location-token.js";
import { textContext } from "../tests/fixtures/text.js";

const generated = (tokens as typeof tokens & { encodeGeneratedLocation: typeof tokens.encodeLocation }).encodeGeneratedLocation;
const payload: api.LocationPayload = { version: 1, sourceSha256: "a".repeat(64), generation: 0,
  part: "/main.xml", story: "body", path: [], range: null };
for (const field of ["part", "story"] as const) for (const delta of [-1, 0, 1])
it(`classifies generated ${field} string capacity at delta ${delta}`, () => {
  const length = (field === "part" ? 4096 : 8192) + delta;
  const value = { ...payload, [field]: field === "part" ? "/" + "a".repeat(length - 1) : "a".repeat(length) };
  if (delta <= 0) expect(tokens.decodeLocation(generated(value))).toEqual(value);
  else {
    expect(() => tokens.encodeLocation(value)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(() => generated(value)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  }
});

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const) for (const length of [4096, 4097])
it(`classifies admitted long main-part metadata; strict=${strict}; route=${route}; length=${length}`, async () => {
  const name = "a".repeat(length - 5) + ".xml", part = "/" + name;
  expect(part).toHaveLength(length);
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="${name}"/></Relationships>`,
    [name]: `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>ẹ́ 日本 العربية 𠀀</w:t></w:r></w:p></w:body></w:document>`
  };
  const context = { ...textContext, limits: { ...textContext.limits, maxPathBytes: 8192 } };
  const memory = Volume.fromJSON({ "/input": "", "/out": "Retain destination", "/stdout": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: Object.entries(files).map(([name, xml]) => ({ name,
    bytes: new TextEncoder().encode(xml), directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
  { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await api.Document(input, context)).paragraphs[0]!.text).toBe("ẹ́ 日本 العربية 𠀀");
  if (route === "sdk") {
    const result = api.extractDocumentText(input, context);
    if (length === 4096) expect((await result).text).toBe("ẹ́ 日本 العربية 𠀀");
    else await expect(result).rejects.toMatchObject({ code: "limit-exceeded" });
  } else {
    const result = await api.createDocxInspectionCommandEngine({ limits: context.limits }).execute({
      args: ["text", "/input", "--json"].map(arg => new TextEncoder().encode(arg)), cwd: "/", signal: context.signal,
      filesystem: { async readFile(path) { return new Uint8Array(memory.readFileSync(path) as Buffer); } },
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { memory.appendFileSync("/stdout", bytes); } }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(length === 4096 ? 0 : 4);
    const envelope = JSON.parse(String(memory.readFileSync("/stdout")));
    if (length === 4096) expect(envelope.data.text).toBe("ẹ́ 日本 العربية 𠀀");
    else expect(envelope).toMatchObject({ ok: false, data: null, errors: [{ code: "limit-exceeded" }], affected: 0, locations: [] });
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  expect(String(memory.readFileSync("/out"))).toBe("Retain destination");
});
