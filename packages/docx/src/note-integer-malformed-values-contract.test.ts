import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const field of ["id", "start"] as const) for (const raw of ["&#xA0;+3", "1e0", "0x3", "3.0", "+", "-2", "9007199254740992"])
it(`malformed note ${field}=${raw} rejects before publication; ${kind}; strict=${strict}`, async () => {
  const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="3"/></w:r></w:p><w:sectPr>${field === "start" ? `<w:${kind}Pr><w:numStart w:val="${raw}"/></w:${kind}Pr>` : ""}</w:sectPr>`, {
    [kind + "s"]: {kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}"><w:${kind} w:id="${field === "id" ? raw : "3"}"><w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>Retained</w:t></w:r></w:p></w:${kind}></w:${kind}s>`}
  }, strict);
  const volume = Volume.fromJSON({"/input": Buffer.from(input), "/binary": "", "/out": ""});
  await expect(api.inspectDocumentNotes(input, {operation: "notes.list", options: {kind}}, textContext)).rejects.toMatchObject({code: "invalid-package"});
  await expect(api.editDocumentNotes(input, {operation: "notes.set", options: {kind, note: 1, text: "Denied", output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {volume.appendFileSync("/binary", bytes);}}})).rejects.toMatchObject({code: "invalid-package"});
  const result = await api.createDocxInspectionCommandEngine({limits: textContext.limits}).execute({
    args: ["notes", "set", "/input", "--kind", kind, "--note", "1", "--text", "Denied", "--dry-run", "--json"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: {async readFile(path) {return new Uint8Array(volume.readFileSync(path) as Buffer);}}, stdin: {async *[Symbol.asyncIterator]() {}}, stdout: {async write(bytes) {volume.appendFileSync("/out", bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(1); expect(JSON.parse(volume.readFileSync("/out", "utf8") as string)).toMatchObject({ok: false, affected: 0, data: null, errors: [{code: "invalid-package"}]});
  expect(volume.readFileSync("/binary", "utf8")).toBe(""); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
