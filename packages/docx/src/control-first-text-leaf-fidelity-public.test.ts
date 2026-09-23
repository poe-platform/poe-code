import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage, xmlStructure } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
const encode = (value: string) => new TextEncoder().encode(value);
const scalars = [
  { kind: "plain", properties: "<w:text/>", options: { text: "New 海🌊" }, display: "New 海🌊" },
  { kind: "rich", properties: "<w:richText/>", options: { text: "New 海🌊" }, display: "New 海🌊" },
  ...["text", "richText"].flatMap(kind => ["", "\tNew 海\n🌊", "\n New 海\t🌊 ", " New 海\t\n🌊 "].map(text => ({ kind: `${kind} ${JSON.stringify(text)}`, properties: `<w:${kind}/>`, options: { text }, display: text }))),
  ...["dropDownList", "comboBox"].map(kind => ({ kind, properties: `<w:${kind}><w:listItem w:value="new" w:displayText="New 海🌊"/></w:${kind}>`, options: { choice: "new" }, display: "New 海🌊" })),
  { kind: "checkbox", properties: '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="0"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>', options: { checked: true }, display: "☒" },
  { kind: "date", properties: '<w:date w:fullDate="2000-01-01T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>', options: { date: "2000-02-29" }, display: "2000-02-29" }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const) for (const runtime of ["source", "native"] as const)
for (const route of ["sdk", "cli"] as const) for (const scalar of scalars) for (const space of ["preserve", "default", "missing"] as const)
it(`retains first scalar text-leaf attributes and trivia placement; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; scalar=${scalar.kind}${space === "preserve" ? "" : "; space=" + space}`, async () => {
  const product: typeof api = runtime === "native" ? native : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const head = "<!--head 海🌊--><?audit \t head?>", tail = "<!--tail 海🌊--><?audit \t tail?>";
  const storedSpace = space === "missing" ? "" : ` xml:space="${space}"`;
  const parts = readPackage(await textFixture(`<w:p><w:r><w:t>Outside</w:t></w:r><w:sdt><w:sdtPr>${scalar.properties}</w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t xml:lang="cy"${storedSpace}>${head}Old${tail}</w:t></w:r></w:sdtContent></w:sdt></w:p>`, {}, strict, { kind }));
  const decoding = codec === "utf16be" ? "utf-16be" : codec === "utf16le" ? "utf-16le" : "utf-8";
  for (const [name, bytes] of parts) if (codec !== "utf8") {
    const buffer = Buffer.from("\ufeff" + new TextDecoder("utf-8", { fatal: true }).decode(bytes), "utf16le");
    if (codec === "utf16be") buffer.swap16();
    parts.set(name, new Uint8Array(buffer));
    expect([...buffer.slice(0, 2)]).toEqual(codec === "utf16be" ? [254, 255] : [255, 254]);
    expect(new TextDecoder(decoding, { fatal: true }).decode(buffer)).toBe(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  if (route === "sdk") await product.editDocumentControls(input, { control: 1, ...scalar.options, output: "-" }, { ...context, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
  else {
    const fs = new MemoryFileSystem(), retained = encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
      const flags = Object.entries(scalar.options).map(([name, value]) => `--${name} ${quote(String(value))}`).join(" ");
      const response = await shell.exec(`docx controls set /input --control 1 ${flags} --output /output --force --json`);
      if (response.exitCode !== 0) expect(await fs.readFile("/output")).toEqual(retained);
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      expect(await fs.readFile("/input")).toEqual(original);
      memory.writeFileSync("/output", await fs.readFile("/output"));
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  assertPackageLinks(new Map([...saved].map(([name, bytes]) => [name, encode(new TextDecoder(decoding, { fatal: true }).decode(bytes))])));
  const source = new TextDecoder(decoding, { fatal: true }).decode(saved.get("word/document.xml")!);
  const firstFragment = scalar.display.split("\t")[0]!.split("\n")[0]!;
  expect(source).toContain(`<w:t xml:lang="cy" xml:space="preserve">${head}${firstFragment}${tail}</w:t>`);
  const pending = [xmlStructure(encode(source))];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.name.endsWith("}t") && !node.children.includes("Outside")) expect(node.attributes).toMatchObject({
      "{http://www.w3.org/XML/1998/namespace}lang": "cy", "{http://www.w3.org/XML/1998/namespace}space": "preserve"
    });
    for (const child of node.children) if (typeof child !== "string") pending.push(child);
  }
  expect((await product.extractDocumentText(new Uint8Array(memory.readFileSync("/output") as Buffer), context)).text).toBe("Outside" + scalar.display);
  if (codec !== "utf8") expect([...saved.get("word/document.xml")!.slice(0, 2)]).toEqual(codec === "utf16be" ? [254, 255] : [255, 254]);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(input).toEqual(original); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});
