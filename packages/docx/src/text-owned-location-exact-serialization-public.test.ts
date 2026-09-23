import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const view of ["final", "original", "all"] as const)
for (const route of ["source-sdk", "native-sdk", "native-locations", "native-cli"] as const)
it(`exact TextData bytes retain escaped Unicode and shared nested locations; strict=${strict}; kind=${kind}; codec=${codec}; view=${view}; route=${route}`, async () => {
  const api = route === "source-sdk" ? source : native;
  expect(native.extractDocumentText).not.toBe(source.extractDocumentText);
  const head = '<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/>', tail = '<w:p/></w:tc></w:tr></w:tbl>';
  const text = '<w:r><w:rPr><w:rFonts w:ascii="A&amp;B&quot;C"/><w:lang w:val="ja-JP"/></w:rPr><w:t xml:space="preserve">&quot;\\海🌊 é</w:t><w:tab/><w:t>Tail</w:t><w:br/></w:r>';
  const body = head.repeat(16) + '<w:p>' + text + '<w:del w:id="1" w:author="Stored&quot;海" w:date="2026-03-04T05:06:07Z"><w:r><w:delText>Removed</w:delText></w:r></w:del><w:ins w:id="2" w:author="Stored\\海" w:date="2026-03-04T05:06:07Z"><w:r><w:t>Added</w:t></w:r></w:ins></w:p>' + tail.repeat(16);
  const parts = readPackage(await textFixture(body, {}, strict, { kind }), textContext.limits);
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") buffer.swap16();
    parts.set(name, new Uint8Array(buffer));
  }
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = input.slice();
  const expected = await api.extractDocumentText(input, textContext, { view });
  expect(expected.text).toBe("\n".repeat(16) + '"\\海🌊 é\tTail\n' + (view === "final" ? "Added" : view === "original" ? "Removed" : "RemovedAdded") + "\n".repeat(16));
  expect(expected.segments.map(segment => segment.text).join("")).toBe(expected.text);
  expect(new Set(expected.segments.map(segment => segment.location.token)).size).toBeLessThan(expected.segments.length);
  if (route === "native-cli") {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = `docx text get /input --view ${view} --json`, baseline = await shell.exec(command);
      expect(baseline.exitCode, baseline.stdout + baseline.stderr).toBe(0);
      expect(JSON.parse(baseline.stdout).data).toEqual(expected);
      const size = Buffer.byteLength(baseline.stdout), exact = await shell.exec(command + ` --limit serializedOutput=${size}`), below = await shell.exec(command + ` --limit serializedOutput=${size - 1}`);
      expect(exact.exitCode, exact.stdout + exact.stderr).toBe(0); expect(exact.stdout).toBe(baseline.stdout);
      expect(below.exitCode, below.stdout + below.stderr).toBe(4);
      expect(JSON.parse(below.stdout)).toMatchObject({ data: null, affected: 0, errors: [{ code: "limit-exceeded" }] });
      expect(await fs.readFile("/input")).toEqual(before);
    } finally { await shell.dispose(); }
  } else {
    const size = Buffer.byteLength(JSON.stringify(expected));
    if (route === "native-locations") {
      const exact = await api.openDocumentLocations(input, textContext, "inventory"), below = await api.openDocumentLocations(input, textContext, "inventory");
      expect(exact.text({ view, limit: [{ name: "serializedOutput", value: size }] })).toEqual(expected);
      expect(() => below.text({ view, limit: [{ name: "serializedOutput", value: size - 1 }] })).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
    } else {
      expect(await api.extractDocumentText(input, textContext, { view, limit: [{ name: "serializedOutput", value: size }] })).toEqual(expected);
      await expect(api.extractDocumentText(input, textContext, { view, limit: [{ name: "serializedOutput", value: size - 1 }] })).rejects.toMatchObject({ code: "limit-exceeded" });
    }
  }
  expect(input).toEqual(before); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(before);
  for (const [name, bytes] of readPackage(input, textContext.limits)) expect(bytes).toEqual(parts.get(name));
});

for (const route of ["source", "native"] as const)
it(`${route} public zero-length ranges expose the exact decoded canonical payload for negative zero`, async () => {
  const api = route === "source" ? source : native;
  const input = await textFixture('<w:p><w:r><w:t>海🌊</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/input": Buffer.from(input) });
  const locations = await api.openDocumentLocations(new Uint8Array(memory.readFileSync("/input") as Buffer), textContext, "inventory");
  const paragraph = locations.at("paragraph", 1), ranged = locations.range(paragraph.token, -0, -0);
  expect(ranged.value).toEqual(api.decodeLocation(ranged.token));
  expect(Object.is(ranged.value.range!.start, -0)).toBe(false);
  expect(Object.is(ranged.value.range!.end, -0)).toBe(false);
  expect(locations.text({ select: ranged.token }).text).toBe("");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const route of ["source", "native"] as const)
for (const story of ["ASCII\"\\\n", "é", "\u0085", "\u2028", "𠀀海🌊", "\ud800"])
it(`${route} public location encoding keeps exact canonical UTF8 for story ${JSON.stringify(story)}`, () => {
  const api = route === "source" ? source : native;
  const memory = Volume.fromJSON({ "/payload": JSON.stringify({ version: 1, sourceSha256: "a".repeat(64), generation: 0, part: "/word/document.xml", story, path: [0, 0], range: { start: 0, end: 1 } }) });
  const json = String(memory.readFileSync("/payload")), payload = JSON.parse(json), expected = "docx-loc-v1." + Buffer.from(json, "utf8").toString("base64url");
  const token = api.encodeLocation(payload); expect(token).toBe(expected); expect(api.decodeLocation(token)).toEqual(payload);
  expect(String(memory.readFileSync("/payload"))).toBe(json);
});

for (const route of ["source", "native"] as const) for (const size of [24575, 24576, 24577])
it(`${route} public non-ASCII location encoding keeps exact byte ceiling ${size}`, () => {
  const api = route === "source" ? source : native, payload = { version: 1 as const, sourceSha256: "a".repeat(64), generation: 0, part: "/word/document.xml", story: "", path: Array<number>(10000).fill(0), range: null };
  const remaining = size - Buffer.byteLength(JSON.stringify(payload)); payload.story = "é".repeat(Math.floor(remaining / 2)) + "a".repeat(remaining % 2);
  const memory = Volume.fromJSON({ "/payload": JSON.stringify(payload) }), json = String(memory.readFileSync("/payload")); expect(Buffer.byteLength(json)).toBe(size);
  if (size <= 24576) { const token = api.encodeLocation(JSON.parse(json)); expect(token).toBe("docx-loc-v1." + Buffer.from(json, "utf8").toString("base64url")); expect(api.decodeLocation(token)).toEqual(payload); }
  else expect(() => api.encodeLocation(JSON.parse(json))).toThrowError(expect.objectContaining({ code: "usage" }));
  expect(String(memory.readFileSync("/payload"))).toBe(json);
});
