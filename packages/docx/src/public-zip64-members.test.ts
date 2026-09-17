import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, createDocxInspectionCommandEngine, inspectDocument, replaceDocumentText } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { zip64Document } from "../tests/fixtures/zip64-members.js";
import { readPackage } from "../tests/assertions.js";

const context = { ...textContext, limits: { ...textContext.limits, maxExtraBytes: 128 } };
const encode = (value: string) => new TextEncoder().encode(value);
async function runCli(input: Uint8Array, edit = false) {
  const volume = Volume.fromJSON({ "/input.bin": Buffer.from(input), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: context.limits }).execute({
    args: (edit ? ["text", "replace", "/input.bin", "--find", "Wide member", "--with", "Edited member", "--first", "--output", "-"] : ["inspect", "/input.bin", "--json"]).map(encode), cwd: "/", signal: context.signal,
    filesystem: { async readFile(path) { expect(path).toBe("/input.bin"); return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { [Symbol.asyncIterator]() { throw new Error("Unexpected input acquisition"); } },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(volume.readFileSync("/input.bin")).toEqual(Buffer.from(input));
  return { exit: result.exitCode, envelope: edit ? null : JSON.parse(volume.readFileSync("/out", "utf8") as string), output: new Uint8Array(volume.readFileSync("/out") as Buffer) };
}
for (const strict of [false, true]) for (const compression of ["store", "deflate"] as const) for (const fields of ["sizes", "offset", "both"] as const) for (const descriptor of ["none", "unsigned", "signed"] as const) for (const route of ["model", "sdk", "cli"] as const) it(`reads and edits ${fields} with ${descriptor} descriptor ${compression} strict=${strict} via ${route}`, async () => {
  const { input, parts, kind, namespace } = zip64Document({ strict, compression, fields, descriptor }), original = input.slice();
  const volume = Volume.fromJSON({ "/saved": "" });
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/saved", bytes); } };
  let saved: Uint8Array;
  if (route === "model") {
    const document = await Document(input, context);
    expect(String(document.part.partname)).toBe("/reports/body.xml"); expect(document.part.element.namespace).toBe(namespace); expect(document.paragraphs[0]!.text).toBe("Wide member");
    document.paragraphs[0]!.runs[0]!.text = "Edited member";
    await document.save(sink);
    saved = new Uint8Array(volume.readFileSync("/saved") as Buffer);
  } else {
    const result = route === "cli" ? await runCli(input) : null;
    if (result) { expect(result.exit).toBe(0); expect(result.envelope).toMatchObject({ ok: true, affected: 0, errors: [] }); }
    const data = result ? result.envelope.data : await inspectDocument(input, context);
    expect(data.kind).toBe(kind); expect(data.dialect).toBe(strict ? "strict" : "transitional"); expect(data.counts.paragraphs).toBe(1);
    expect(data.parts).toHaveLength(parts.size);
    for (const [name, bytes] of parts) expect(data.parts).toContainEqual(expect.objectContaining({ name: "/" + name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
    if (route === "sdk") {
      expect(await replaceDocumentText(input, { find: "Wide member", with: "Edited member", first: true, output: "-" }, { ...context, encoding: { order: "input", compression: "store" }, stdout: sink })).toMatchObject({ changed: true, changes: [expect.objectContaining({ kind: "replace" })] });
      saved = new Uint8Array(volume.readFileSync("/saved") as Buffer);
    } else { const edited = await runCli(input, true); expect(edited.exit).toBe(0); saved = edited.output; }
  }
  const output = readPackage(saved);
  expect([...output.keys()].sort()).toEqual([...parts.keys()].sort());
  for (const [name, bytes] of parts) if (name !== "reports/body.xml") expect(output.get(name)).toEqual(bytes);
  const main = new TextDecoder().decode(output.get("reports/body.xml"));
  expect(main).toContain("<!--original-->"); expect(main).toContain(">Edited member<"); expect(main).toContain(`<n:document xmlns:n="${namespace}">`);
  const reloaded = await Document(saved, context);
  expect(String(reloaded.part.partname)).toBe("/reports/body.xml"); expect(reloaded.paragraphs[0]!.text).toBe("Edited member");
  expect(input).toEqual(original);
});
for (const strict of [false, true]) for (const compression of ["store", "deflate"] as const) for (const fault of ["wide-size-limit", "wide-offset", "descriptor-size", "descriptor-crc"] as const) for (const route of ["model", "sdk", "cli"] as const) it(`refuses ${fault} ${compression} strict=${strict} via ${route}`, async () => {
  const { input, positions } = zip64Document({ strict, compression, fields: "both", descriptor: "signed" }), first = positions[0]!, view = new DataView(input.buffer);
  if (fault === "wide-size-limit") view.setBigUint64(first.centralExtra + 4, BigInt(context.limits.maxEntryBytes + 1), true);
  if (fault === "wide-offset") view.setBigUint64(first.centralExtra + 20, BigInt(input.length + 1), true);
  if (fault === "descriptor-size") view.setBigUint64(first.descriptor + 16, view.getBigUint64(first.descriptor + 16, true) + 1n, true);
  if (fault === "descriptor-crc") view.setUint32(first.descriptor + 4, (view.getUint32(first.descriptor + 4, true) ^ 1) >>> 0, true);
  const original = input.slice(), code = fault === "wide-size-limit" ? "limit-exceeded" : "invalid-container";
  if (route === "model") await expect(Document(input, context)).rejects.toMatchObject({ code });
  else if (route === "sdk") await expect(inspectDocument(input, context)).rejects.toMatchObject({ code });
  else { const result = await runCli(input); expect(result.exit).toBe(fault === "wide-size-limit" ? 4 : 1); expect(result.envelope).toMatchObject({ ok: false, affected: 0, data: null, locations: [], errors: [expect.objectContaining({ code })] }); }
  expect(input).toEqual(original);
});
