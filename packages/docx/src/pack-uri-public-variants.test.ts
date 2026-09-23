import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { PackURI, executeDocumentBatch, createDocxInspectionCommandEngine } from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

const prefix = "model.opc.packuri.PackURI";
const uri = { resultHandle: "uri" };
const enc = (value: string) => new TextEncoder().encode(value);
const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
const cases = [
  { input: "/", value: "/", base: "/", ext: "", file: "", index: null, member: "", rels: "/_rels/.rels", relative: null },
  { input: "/page0.xml", value: "/page0.xml", base: "/", ext: "xml", file: "page0.xml", index: 0, member: "page0.xml", rels: "/_rels/page0.xml.rels", relative: "../page0.xml" },
  { input: "/reports/page001.XML", value: "/reports/page001.XML", base: "/reports", ext: "XML", file: "page001.XML", index: 1, member: "reports/page001.XML", rels: "/reports/_rels/page001.XML.rels", relative: "../reports/page001.XML" },
  { input: "/2page.xml", value: "/2page.xml", base: "/", ext: "xml", file: "2page.xml", index: null, member: "2page.xml", rels: "/_rels/2page.xml.rels", relative: "../2page.xml" },
  { input: "/page12.tar.xml", value: "/page12.tar.xml", base: "/", ext: "xml", file: "page12.tar.xml", index: null, member: "page12.tar.xml", rels: "/_rels/page12.tar.xml.rels", relative: "../page12.tar.xml" },
  { input: "/page42", value: "/page42", base: "/", ext: "", file: "page42", index: 42, member: "page42", rels: "/_rels/page42.rels", relative: "../page42" },
  { input: "/page9007199254740991.xml", value: "/page9007199254740991.xml", base: "/", ext: "xml", file: "page9007199254740991.xml", index: Number.MAX_SAFE_INTEGER, member: "page9007199254740991.xml", rels: "/_rels/page9007199254740991.xml.rels", relative: "../page9007199254740991.xml" },
  { input: "/reports/caf%C3%A9.xml", value: "/reports/café.xml", base: "/reports", ext: "xml", file: "café.xml", index: null, member: "reports/café.xml", rels: "/reports/_rels/café.xml.rels", relative: "../reports/caf%C3%A9.xml" },
  { input: "/reports/a:café.xml", value: "/reports/a:café.xml", base: "/reports", ext: "xml", file: "a:café.xml", index: null, member: "reports/a:café.xml", rels: "/reports/_rels/a:café.xml.rels", relative: "../reports/a:caf%C3%A9.xml" }
] as const;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it.each(cases)(`${route} exposes every immutable URI field for $input; ${kind} strict=${strict}`, async item => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/sentinel": "retained" });
  const operations = [
    { operation: prefix + ".call", arguments: { packUriStr: item.input }, resultHandle: "uri" },
    ...["baseURI", "ext", "filename", "idx", "membername"].map(member => ({ operation: prefix + "." + member + ".get", receiver: uri, arguments: {} })),
    { operation: prefix + ".rels_uri.get", receiver: uri, arguments: {}, resultHandle: "rels" },
    { operation: prefix + ".string_protocol.call", receiver: uri, arguments: {} },
    { operation: prefix + ".filename.get", receiver: { resultHandle: "rels" }, arguments: {} }
  ];
  const expected: unknown[] = [item.value, item.base, item.ext, item.file, item.index, item.member, item.rels, item.value, item.file + ".rels"];
  if (item.relative !== null) {
    operations.push({ operation: prefix + ".relative_ref.call", receiver: uri, arguments: { baseURI: "/other" } });
    expected.push(item.relative);
  }
  if (route === "model") {
    const value = new PackURI(item.input);
    expect([String(value), value.baseURI, value.ext, value.filename, value.idx, value.membername, String(value.rels_uri), value.toString(), value.rels_uri.filename,
      ...(item.relative === null ? [] : [value.relative_ref("/other")])]).toEqual(expected);
    expect(Object.isFrozen(value)).toBe(true);
    expect(JSON.stringify(value)).toBe(JSON.stringify(item.value));
    expect(() => Object.assign(value, { filename: "changed.xml" })).toThrow();
    expect(value.filename).toBe(item.file);
  } else if (route === "sdk") {
    const result = await executeDocumentBatch(input, { version: 1, operations }, {}, context);
    expect(result.publication).toBeNull();
    expect(result.results.map(result => result.data)).toEqual(expected);
    expect(result.results.every(result => result.ok && result.affected === 0)).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", enc("retained"));
    await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const result = JSON.parse(response.stdout);
      expect(result).toMatchObject({ version: 1, operation: "batch", ok: true, affected: 0, data: { publication: null }, errors: [] });
      expect(result.data.results.map((step: { data: unknown }) => step.data)).toEqual(expected);
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/sentinel")).toEqual(enc("retained"));
    } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  expect(volume.readFileSync("/sentinel", "utf8")).toBe("retained");
});

const references = [
  ["/reports/pages", "../layouts/layout1.xml", "/reports/layouts/layout1.xml"],
  ["/reports", "", "/reports"], ["/", "", "/"],
  ["/reports", "./a:caf%C3%A9.xml", "/reports/a:café.xml"],
  ["/", "reports/page1.xml", "/reports/page1.xml"],
  ["/reports", "page1.xml", "/reports/page1.xml"],
  ["/", "../escape.xml", "/escape.xml"]
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it.each(references)(`${route} resolves URI directory %s reference %s; ${kind} strict=${strict}`, async (base, target, expected) => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const operations = [
    { operation: prefix + ".from_rel_ref.call", arguments: { baseURI: base, relativeRef: target }, resultHandle: "uri" },
    { operation: prefix + ".string_protocol.call", receiver: uri, arguments: {} }
  ];
  if (route === "model") expect(String(PackURI.from_rel_ref(base, target))).toBe(expected);
  else if (route === "sdk") {
    const result = await executeDocumentBatch(input, { version: 1, operations }, {}, context);
    expect(result.results.map(step => step.data)).toEqual([expected, expected]); expect(result.publication).toBeNull();
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const result = JSON.parse(response.stdout); expect(result.data.results.map((step: { data: unknown }) => step.data)).toEqual([expected, expected]);
      expect(result).toMatchObject({ affected: 0, data: { publication: null } }); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
});

const rejected = [
  ...[undefined, null, false, 0, {}].map((value, index) => ({ name: "constructor type " + index, member: "call", args: value === undefined ? {} : { packUriStr: value }, code: "usage" })),
  ...["relative", "", "/a//b", "/a/../b", "/a%2fb", "/a%5cb", "/a b", "/a?x", "/a#x", "/a%FF"].map(value => ({ name: "constructor spelling " + value, member: "call", args: { packUriStr: value }, code: "invalid-package" })),
  { name: "unsafe filename number", member: "idx.get", args: {}, code: "usage", input: "/page9007199254740992.xml" },
  { name: "root is not a relative part target", member: "relative_ref.call", args: { baseURI: "/reports" }, code: "usage", input: "/" },
  { name: "relative directory null", member: "relative_ref.call", args: { baseURI: null }, code: "usage", input: "/reports/page.xml" },
  { name: "relative directory omitted", member: "relative_ref.call", args: {}, code: "usage", input: "/reports/page.xml" },
  { name: "relative constructor fragment", member: "from_rel_ref.call", args: { baseURI: "/reports", relativeRef: "page.xml#anchor" }, code: "invalid-package" },
  { name: "relative constructor external URI", member: "from_rel_ref.call", args: { baseURI: "/", relativeRef: "https://example.invalid/page.xml" }, code: "invalid-package" },
  { name: "relative constructor null base", member: "from_rel_ref.call", args: { baseURI: null, relativeRef: "page.xml" }, code: "usage" },
  { name: "relative constructor null reference", member: "from_rel_ref.call", args: { baseURI: "/", relativeRef: null }, code: "usage" },
  ...[false, 0, 1].map(value => ({ name: "relative directory " + value, member: "relative_ref.call", args: { baseURI: value }, code: "usage", input: "/reports/page.xml" })),
  ...[undefined, false, 0, 1].map(value => ({ name: "relative constructor base " + value, member: "from_rel_ref.call", args: { ...(value === undefined ? {} : { baseURI: value }), relativeRef: "page.xml" }, code: "usage" })),
  ...[undefined, false, 0, 1].map(value => ({ name: "relative constructor reference " + value, member: "from_rel_ref.call", args: { baseURI: "/", ...(value === undefined ? {} : { relativeRef: value }) }, code: "usage" }))
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it.each(rejected)(`${route} rejects URI $name without publication; ${kind} strict=${strict}`, async item => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const original = input.slice();
  const receiverInput = "input" in item ? item.input as string : undefined;
  const args = item.args as Record<string, unknown>;
  const operations = [
    ...(receiverInput === undefined ? [] : [{ operation: prefix + ".call", arguments: { packUriStr: receiverInput }, resultHandle: "uri" }]),
    { operation: prefix + "." + item.member, ...(receiverInput === undefined ? {} : { receiver: uri }), arguments: args }
  ];
  const volume = Volume.fromJSON({ "/sentinel": "retained" });
  if (route === "model") {
    expect(() => {
      if (item.member === "call") return new PackURI(args.packUriStr as string);
      if (item.member === "from_rel_ref.call") return PackURI.from_rel_ref(args.baseURI as string, args.relativeRef as string);
      const value = new PackURI(receiverInput!);
      return item.member === "idx.get" ? value.idx : value.relative_ref(args.baseURI as string);
    }).toThrowError(expect.objectContaining({ code: item.code }));
  } else if (route === "sdk") {
    await expect(executeDocumentBatch(input, { version: 1, operations }, {}, { ...context,
      stdout: { async write(bytes) { volume.writeFileSync("/sentinel", bytes); } }
    })).rejects.toMatchObject({ code: item.code });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", enc("retained"));
    await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(item.code === "usage" ? 2 : 1);
      expect(JSON.parse(response.stdout)).toMatchObject({ version: 1, operation: "batch", ok: false, affected: 0, data: null, errors: [{ code: item.code }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/sentinel")).toEqual(enc("retained"));
    } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/sentinel", "utf8")).toBe("retained");
  expect(input).toEqual(original);
});
