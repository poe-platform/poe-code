import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const domain of ["bookmark", "footnote", "endnote"] as const)
for (const id of [2147483648, 1099511627776, Number.MAX_SAFE_INTEGER])
for (const route of ["sdk", "cli"])
it(`reference storage admits exact safe integer IDs beyond signed 32-bit; strict=${strict}; ${domain}; ${id}; ${route}`, async () => {
  const note = domain !== "bookmark", raw = " &#x9;+0" + id + "&#xA; ";
  const body = note ? `<w:p><w:r><w:${domain}Reference w:id="${raw}"/></w:r></w:p>` : `<w:p><w:bookmarkStart w:id="${raw}" w:name="Coast"/><w:r><w:t>Retained é 海</w:t></w:r><w:bookmarkEnd w:id="${id}"/></w:p>`;
  const stories = note ? { [domain + "s"]: { kind: domain + "s", xml: `<w:${domain}s xmlns:w="${w}"><w:${domain} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${domain}><w:${domain} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${domain}><w:${domain} w:id="${id}"><!--body--><?owner retain?><w:p><w:r><w:${domain}Ref/></w:r><w:r><w:t>Old é 海</w:t></w:r></w:p></w:${domain}></w:${domain}s>` } } : {};
  const input = await textFixture(body, stories, strict), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  // The public model factory shares admission with utility/typed-batch routes.
  expect((await api.Document(input, textContext)).paragraphs).toHaveLength(1);
  if (route === "sdk") {
    if (note) { expect((await api.inspectDocumentNotes(input, { operation: "notes.get", options: { kind: domain, note: 1 } }, textContext)).items[0]!.id).toBe(id); await api.editDocumentNotes(input, { operation: "notes.set", options: { kind: domain, note: 1, text: "New é 海", output: "-" } }, context); }
    else { expect((await api.inspectDocumentBookmarks(input, {}, textContext)).items[0]!.id).toBe(String(id)); await api.editDocumentBookmarks(input, { operation: "bookmarks.set", options: { bookmark: 1, name: "Estuary", references: "update", output: "-" } }, context); }
  } else {
    const args = note ? ["notes", "set", "/input", "--kind", domain, "--note", "1", "--text", "New é 海", "--output", "-"] : ["bookmarks", "set", "/input", "--bookmark", "1", "--name", "Estuary", "--references", "update", "--output", "-"];
    const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: context.stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output), dirty = note ? `word/${domain}s.xml` : "word/document.xml";
  for (const [name, bytes] of before) if (name !== dirty) expect(after.get(name), name).toEqual(bytes);
  if (note) { const item = (await api.inspectDocumentNotes(output, { operation: "notes.get", options: { kind: domain, note: 1 } }, textContext)).items[0]!; expect(item.id).toBe(id); expect(item.references).toHaveLength(1); expect(item.text).toBe("New é 海"); expect(new TextDecoder().decode(after.get(dirty))).toContain('<!--body--><?owner retain?>'); }
  else { expect((await api.inspectDocumentBookmarks(output, {}, textContext)).items[0]).toMatchObject({ id: String(id), name: "Estuary" }); expect(new TextDecoder().decode(after.get(dirty))).toContain(raw); }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
