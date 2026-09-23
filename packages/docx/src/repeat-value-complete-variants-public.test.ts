import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
const field = (properties = "<w:text/>", tag = "name", id = 3, value = "Old") => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:tag w:val="${tag}"/>${properties}<w:placeholder><w:docPart w:val="Retained definition"/></w:placeholder></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>${value}</w:t></w:r></w:sdtContent></w:sdt>`;
const record = (value: string | boolean | number) => ({ values: [{ binding: "name", value }] });
const item = (blocks: string, properties = "", id = 2) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><v:repeatingSectionItem/>${properties}</w:sdtPr><w:sdtContent>${blocks}</w:sdtContent></w:sdt>`;
interface Scenario { name: string; fields?: string; data?: { values: { binding: string; value: string | number | boolean }[] }[]; blocks?: string; outer?: string; prior?: string; error?: string; display?: string; emptyRefill?: boolean; }
const scenarios: Scenario[] = [
  { name: "literal Unicode tabs breaks empty", data: [record("海🌊\tBay\nNext"), record("")], display: "海🌊\tBay\nNext\n" },
  { name: "empty reusable prototype", data: [], display: "", emptyRefill: true },
  { name: "rich text", fields: field("<w:richText/>"), data: [record("Rich海")], display: "Rich海" },
  { name: "choice declared stored value", fields: field('<w:dropDownList><w:listItem w:value="stored" w:displayText="Displayed海"/></w:dropDownList>'), data: [record("stored")], display: "Displayed海" },
  { name: "choice label refuses", fields: field('<w:dropDownList><w:listItem w:value="stored" w:displayText="Displayed海"/></w:dropDownList>'), data: [record("Displayed海")], error: "usage" },
  { name: "checkbox false", fields: field('<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="1"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>'), data: [record(false)], display: "☐" },
  { name: "checkbox malformed unused glyph", fields: field('<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="1"/><c:checkedState c:val="D800" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>'), data: [record(false)], error: "unsupported-edit" },
  { name: "date leap day", fields: field('<w:date><w:dateFormat w:val="dd/MM/yyyy"/><w:lid w:val="en-GB"/><w:calendar w:val="gregorian"/></w:date>'), data: [record("2000-02-29")], display: "29/02/2000" },
  { name: "date century nonleap", fields: field("<w:date/>"), data: [record("1900-02-29")], error: "usage" },
  { name: "date unsupported format", fields: field('<w:date><w:dateFormat w:val="MMMM d, yyyy"/></w:date>'), data: [record("2026-04-03")], error: "unsupported-edit" },
  { name: "missing record key", data: [{ values: [] }], error: "usage" },
  { name: "extra record key", data: [{ values: [{ binding: "other", value: "New" }] }], error: "usage" },
  { name: "duplicate record key", data: [{ values: [{ binding: "name", value: "A" }, { binding: "name", value: "B" }] }], error: "usage" },
  { name: "no scalar coercion zero", data: [record(0)], error: "usage" },
  { name: "no scalar coercion false", data: [record(false)], error: "usage" },
  ...["sdtLocked", "contentLocked", "sdtContentLocked", "unknown"].map(lock => ({ name: `outer lock ${lock}`, outer: `<w:lock w:val="${lock}"/>`, error: "unsupported-edit" })),
  { name: "bound outer", outer: '<w:dataBinding w:storeItemID="retained" w:xpath="/root/value"/>', error: "unsupported-edit" },
  { name: "bound scalar", fields: field('<w:text/><w:dataBinding w:storeItemID="retained" w:xpath="/root/value"/>'), error: "unsupported-edit" },
  { name: "locked scalar", fields: field('<w:text/><w:lock w:val="contentLocked"/>'), error: "unsupported-edit" },
  { name: "opaque native node", blocks: `<w:p>${field()}<w:future w:val="retained"/></w:p>`, error: "unsupported-edit" },
  { name: "opaque native attribute", blocks: `<w:p w:future="retained">${field()}</w:p>`, error: "unsupported-edit" },
  { name: "affected revision", fields: `<w:ins w:id="11" w:author="Retained">${field()}</w:ins>`, error: "unsupported-edit" },
  { name: "prior stale schema", prior: item(`<w:p>${field("<w:text/>", "extra", 5)}</w:p>`, "", 4), error: "unsupported-edit" },
  { name: "prior cached field", prior: item(`<w:p>${field().replace('w:val="3"', 'w:val="5"').replace("</w:sdtContent>", '<w:fldSimple w:instr="QUOTE"><w:r><w:t>Retained</w:t></w:r></w:fldSimple></w:sdtContent>')}</w:p>`, "", 4), error: "unsupported-edit" }
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const shape of ["block", "row"] as const) for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
for (const scenario of scenarios)
it(`complete repeat value ${scenario.name}; strict=${strict}; kind=${kind}; shape=${shape}; codec=${codec}; route=${route}`, async () => {
  const product = route.startsWith("native") ? native : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const blocks = scenario.blocks ?? `<w:p>${scenario.fields ?? field()}</w:p>`;
  const priorBlocks = scenario.prior?.slice(scenario.prior.indexOf("<w:sdtContent>") + "<w:sdtContent>".length, scenario.prior.lastIndexOf("</w:sdtContent>"));
  const contents = item(shape === "row" ? `<w:tr><w:tc>${blocks}</w:tc></w:tr>` : blocks) + (scenario.prior ? shape === "row" ? item(`<w:tr><w:tc>${priorBlocks}</w:tc></w:tr>`, "", 4) : scenario.prior : "");
  const region = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/>${scenario.outer ?? ""}</w:sdtPr><w:sdtContent>${contents}</w:sdtContent></w:sdt>`;
  const parts = readPackage(await textFixture(`<w:p><w:r><w:t>Outside {{name}}</w:t></w:r></w:p>` + (shape === "row" ? `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region}</w:tbl>` : region) + "<!--retain--><?audit exact?>", {}, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) { const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") encoded.swap16(); parts.set(name, new Uint8Array(encoded)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const data = scenario.data ?? [record("New海")], arguments_ = { control: 1, data }, batch = { version: 1 as const, operations: [{ operation: "controls.repeat" as const, arguments: arguments_ }] };
  if (route.includes("sdk")) {
    const io = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route.endsWith("batch") ? product.executeDocumentBatch(input, batch, { output: "-" }, io) : product.editDocumentControlRepeats(input, { ...arguments_, output: "-" }, io);
    if (scenario.error) await expect(pending).rejects.toMatchObject({ code: scenario.error }); else await pending;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = encode("Retained forced destination"); await fs.writeFile("/output", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const command = route.endsWith("batch") ? `docx batch /input --ops-json ${quote(JSON.stringify(batch))}` : `docx controls repeat /input --control 1 --data-json ${quote(JSON.stringify(data))}`;
      const response = await shell.exec(command + " --output /output --force --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(scenario.error ? scenario.error === "usage" ? 2 : 1 : 0);
      if (scenario.error) { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: scenario.error }] }); expect(await fs.readFile("/output")).toEqual(retained); }
      else { expect(JSON.parse(response.stdout).ok).toBe(true); memory.writeFileSync("/output", await fs.readFile("/output")); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts);
  if (scenario.error) { expect(memory.statSync("/output").size).toBe(0); return; }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect([...after.keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect((await product.extractDocumentText(output, context)).text).toBe("Outside {{name}}\n" + scenario.display);
  const controls = (await product.inspectDocumentControls(output, {}, context)).items;
  expect(controls.filter(control => control.kind === "repeating-item")).toHaveLength(Math.max(1, data.length));
  expect(controls.filter(control => control.tag === "name").every(control => control.placeholder === !data.length)).toBe(true);
  expect(new Set(controls.map(control => control.id)).size).toBe(controls.length);
  expect((await product.validateDocument(output, context)).valid).toBe(true);
  if (scenario.emptyRefill) {
    memory.writeFileSync("/output", "");
    await product.editDocumentControlRepeats(output, { control: 1, data: [record("Return海")], output: "-" }, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    expect((await product.extractDocumentText(new Uint8Array(memory.readFileSync("/output") as Buffer), context)).text).toBe("Outside {{name}}\nReturn海");
  }
});
