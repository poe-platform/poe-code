import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, createDocxInspectionCommandEngine, formatDocumentRuns, getDocumentXml, replaceDocumentXmlPart } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { fidelityBytes, xmlFidelityFixture, type FidelityEncoding } from "../tests/fixtures/xml-fidelity.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array, encoding: FidelityEncoding) => new TextDecoder(encoding === "UTF-8-BOM" ? "UTF-8" : encoding, { fatal: true }).decode(bytes);
type Node = ReturnType<typeof xmlStructure>;
const withoutBold = (node: Node, namespace: string): Node => ({ ...node, children: node.children.filter(child => typeof child === "string" || child.name !== `{${namespace}}b`).map(child => typeof child === "string" ? child : withoutBold(child, namespace)) });
async function cli(input: Uint8Array, args: string[], replacement?: Uint8Array) {
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/replacement": Buffer.from(replacement ?? []), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(encode), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { expect(["/input", "/replacement"]).toContain(path); return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { [Symbol.asyncIterator]() { throw new Error("Unexpected stdin acquisition"); } },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  return { exit: result.exitCode, output: new Uint8Array(volume.readFileSync("/out") as Buffer), error: volume.readFileSync("/err", "utf8") as string };
}
for (const strict of [false, true]) for (const encoding of ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] as const) for (const route of ["model", "sdk", "cli"] as const) it(`retains ${encoding} raw bytes and unselected XML after ${route} formatting; strict=${strict}`, async () => {
  const { input, raw, source, parts, w, opaque } = await xmlFidelityFixture(strict, encoding), original = input.slice(), volume = Volume.fromJSON({ "/out": "" });
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  let output: Uint8Array;
  if (route === "model") {
    const document = await Document(input, textContext), copy = document.part.blob;
    expect(copy).toEqual(raw); copy.fill(0); expect(document.part.blob).toEqual(raw);
    expect(document.paragraphs[0]!.text).toBe("  Old é 海 \r  ");
    document.paragraphs[0]!.runs[0]!.bold = true; await document.save(sink); output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  } else {
    const bytes = route === "sdk" ? await getDocumentXml(input, textContext, { part: "/reports/main.xml", raw: true }) : (await cli(input, ["xml", "get", "/input", "--part", "/reports/main.xml", "--raw"])).output;
    expect(bytes).toEqual(raw);
    const metadata = route === "sdk" ? await getDocumentXml(input, textContext, { part: "/reports/main.xml" }) : JSON.parse(new TextDecoder().decode((await cli(input, ["xml", "get", "/input", "--part", "/reports/main.xml", "--json"])).output)).data;
    expect(metadata).toMatchObject({ encoding: "base64", content: Buffer.from(raw).toString("base64"), bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex"), pretty: false });
    const pretty = route === "sdk" ? await getDocumentXml(input, textContext, { part: "/reports/main.xml", pretty: true }) : JSON.parse(new TextDecoder().decode((await cli(input, ["xml", "get", "/input", "--part", "/reports/main.xml", "--pretty", "--json"])).output)).data;
    expect(pretty).toMatchObject({ encoding: "utf-8", pretty: true });
    expect(pretty.content).toContain('  Old é 海 &#13;  '); expect(pretty.content).toContain(opaque); expect(pretty.content).toContain("<!--before--><?audit retain?>"); expect(() => xmlStructure(encode(pretty.content))).not.toThrow();
    if (route === "sdk") { expect(await formatDocumentRuns(input, { paragraph: 1, run: 1, bold: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink })).toMatchObject({ changed: true }); output = new Uint8Array(volume.readFileSync("/out") as Buffer); }
    else { const edited = await cli(input, ["runs", "set", "/input", "--paragraph", "1", "--run", "1", "--bold", "true", "--output", "-"]); expect(edited.exit, edited.error).toBe(0); output = edited.output; }
  }
  const saved = readPackage(output), main = saved.get("reports/main.xml")!, text = decode(main, encoding);
  for (const [name, bytes] of parts) if (name !== "reports/main.xml") expect(saved.get(name)).toEqual(bytes);
  expect(main.subarray(0, encoding === "UTF-8" ? 0 : encoding === "UTF-8-BOM" ? 3 : 2)).toEqual(raw.subarray(0, encoding === "UTF-8" ? 0 : encoding === "UTF-8-BOM" ? 3 : 2));
  expect(text).toContain(opaque); expect(text.startsWith(source.slice(0, source.indexOf("<n:document")))).toBe(true); expect(text.endsWith('<!--after--><?audit end?>')).toBe(true);
  expect(withoutBold(xmlStructure(encode(text)), w)).toEqual(xmlStructure(encode(source)));
  const document = await Document(output, textContext); expect(document.paragraphs[0]!.runs[0]!.bold).toBe(true); expect(document.paragraphs[0]!.text).toBe("  Old é 海 \r  "); expect(input).toEqual(original);
});
for (const strict of [false, true]) for (const encoding of ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] as const) for (const route of ["sdk", "cli"] as const) for (const opaqueEdit of [false, true]) it(`${opaqueEdit ? "refuses opaque changes in" : "publishes explicit replacement of"} ${encoding} through ${route}; strict=${strict}`, async () => {
  const { input, source, parts } = await xmlFidelityFixture(strict, encoding), replacement = fidelityBytes(source.replace(opaqueEdit ? 'x:flag="retained"' : 'Old', opaqueEdit ? 'x:flag="changed"' : 'New'), encoding), volume = Volume.fromJSON({ "/out": "" });
  let output: Uint8Array;
  if (route === "sdk") {
    const pending = replaceDocumentXmlPart(input, replacement, { part: "/reports/main.xml", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
    if (opaqueEdit) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); else expect(await pending).toMatchObject({ changed: true });
    output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  } else { const result = await cli(input, ["xml", "set", "/input", "--part", "/reports/main.xml", "--file", "/replacement", "--output", "-"], replacement); expect(result.exit, result.error).toBe(opaqueEdit ? 1 : 0); if (opaqueEdit) expect(result.error).toContain("unsupported-edit"); output = result.output; }
  if (opaqueEdit) expect(output).toHaveLength(0);
  else { expect(readPackage(output)).toEqual(new Map([...parts].map(([name, bytes]) => [name, name === "reports/main.xml" ? replacement : bytes]))); expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("  New é 海 \r  "); }
});
