import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const id of [-2, -2147483649, -Number.MAX_SAFE_INTEGER]) for (const route of ["sdk", "cli"])
it(`special note identity is defined by type and retains signed storage ID; strict=${strict}; ${kind}; ${id}; ${route}`, async () => {
  const notice = `<w:${kind} w:id="${id}" w:type="continuationNotice"><!--notice--><?owner keep?><w:p><w:r><w:t>Continued é 海</w:t></w:r></w:p></w:${kind}>`;
  const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="8"/></w:r></w:p>`, { [kind + "s"]: { kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>${notice}<w:${kind} w:id="8"><w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>Old Sea</w:t></w:r></w:p></w:${kind}></w:${kind}s>` } }, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const beforeData = await api.inspectDocumentNotes(input, { operation: "notes.list", options: { kind } }, textContext);
  expect(beforeData.separators).toEqual([{ kind, id: -1, type: "separator" }, { kind, id: 0, type: "continuationSeparator" }, { kind, id, type: "continuationNotice" }]);
  if (route === "sdk") await api.editDocumentNotes(input, { operation: "notes.set", options: { kind, note: 1, text: "New Sea", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
  else { const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["notes", "set", "/input", "--kind", kind, "--note", "1", "--text", "New Sea", "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0); }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== `word/${kind}s.xml`) expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get(`word/${kind}s.xml`)), dialectNotice = strict ? notice.split(w).join("http://purl.oclc.org/ooxml/wordprocessingml/main") : notice;
  expect(xml).toContain(dialectNotice); const current = await api.inspectDocumentNotes(output, { operation: "notes.list", options: { kind } }, textContext);
  expect(current.separators).toEqual(beforeData.separators); expect(current.items[0]!.text).toBe("New Sea");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
