import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, editDocumentFields, inspectDocumentFields, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const enc = (value: string) => new TextEncoder().encode(value);
const flags = [
  { value: " true ", expected: true }, { value: "&#x9;1&#xA;", expected: true },
  { value: " false ", expected: false }, { value: "&#xD;0&#x9;", expected: false },
  { value: "on", expected: true }, { value: "off", expected: false }
] as const;

for (const strict of [false, true]) for (const form of ["simple", "complex"] as const)
for (const route of ["sdk", "cli"] as const) it.each(flags)(
  `F22 stored flags $value read and edit retain unrelated bytes; ${form} ${route} strict=${strict}`,
  async ({ value, expected }) => {
    const attributes = `w:dirty="${value}" w:fldLock="${value}"`;
    const text = '<w:r><w:rPr><w:b/></w:rPr><w:t>Old 海</w:t></w:r>';
    const field = form === "simple" ? `<w:fldSimple w:instr=" PAGE " ${attributes}>${text}</w:fldSimple>` :
      `<w:r><w:fldChar w:fldCharType="begin" ${attributes}/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${text}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const input = await textFixture(`<w:p><!--retained--><?original keep?>${field}</w:p>`, {}, strict);
    const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
    const cli = async (args: string[]) => createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: args.map(enc), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } },
      stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    if (route === "sdk") expect((await inspectDocumentFields(input, {}, textContext)).items[0]).toMatchObject({ update: expected, locked: expected });
    else {
      expect((await cli(["fields", "list", "/input", "--json"])).exitCode).toBe(0);
      expect(JSON.parse(volume.readFileSync("/out", "utf8") as string).data.items[0]).toMatchObject({ update: expected, locked: expected });
      volume.writeFileSync("/out", "");
    }
    if (route === "sdk") {
      const result = await editDocumentFields(input, { operation: "fields.set", options: { field: 1, result: "New 海", output: "-" } }, {
        ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
      });
      expect(result.changes).toHaveLength(1);
    } else expect((await cli(["fields", "set", "/input", "--field", "1", "--result", "New 海", "--output", "-"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
    for (const member of before.members) expect(after.members.find(item => item.name === member.name)!.bytes).toEqual(
      member.name === "word/document.xml" ? enc(new TextDecoder().decode(member.bytes).replace("Old 海", "New 海")) : member.bytes
    );
    expect((await inspectDocumentFields(output, {}, textContext)).items[0]).toMatchObject({ result: "New 海", update: expected, locked: expected });
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);

for (const strict of [false, true]) it.each([" on ", " off ", "TRUE", "&#xA0;true", "tr ue", "2"])(
  `F22 malformed stored flag %s rejects before publication strict=${strict}`,
  async value => {
    const input = await textFixture(`<w:p><w:fldSimple w:instr=" PAGE " w:dirty="${value}"><w:r><w:t>Old</w:t></w:r></w:fldSimple></w:p>`, {}, strict);
    const volume = Volume.fromJSON({ "/out": "" });
    await expect(editDocumentFields(input, { operation: "fields.set", options: { field: 1, result: "New", output: "-" } }, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
    })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(volume.readFileSync("/out", "utf8")).toBe("");
  }
);
