import { saveFixture } from "../tests/fixtures/save-output.js";
import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["main", "additional"] as const)
it(`native DocumentPart.save publishes its entire owning package asynchronously; strict=${strict}; kind=${kind}; owner=${owner}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Save the tide</w:t></w:r></w:p>');
  const doc = await api.Document(input, textContext), part = (owner === "main" ? doc.part : await api.DocumentPartView.load("/appendix.xml", doc.part.content_type, doc.part.blob, doc.part.package));
  const before = new Map(doc.part.package.parts.map(part => [part.partname.toString().slice(1), part.blob]));
  const volume = Volume.fromJSON({ "/output": "" });
  expect(part.save).toBeTypeOf("function");
  const result = part.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } }); expect(result).toBeInstanceOf(Promise); await result;
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of before) expect(after.get(name), name).toEqual(bytes);
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Save the tide");
  const rejected = part.save(null as never); expect(rejected).toBeInstanceOf(Promise); await expect(rejected).rejects.toMatchObject({ code: "usage" });
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["main", "additional"] as const)
for (const outputKind of ["sink", "path"] as const)
it(`native DocumentPart.save uses admitted ${outputKind} authority and publishes dirty package state; strict=${strict}; kind=${kind}; owner=${owner}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Before save</w:t></w:r></w:p>');
  const env = saveFixture(), doc = await api.Document(input, { ...textContext, vfs: env.vfs });
  const part = (owner === "main" ? doc.part : await api.DocumentPartView.load("/appendix.xml", doc.part.content_type, doc.part.blob, doc.part.package));
  doc.paragraphs[0]!.text = "Recorded shore — 波";
  const before = new Map(doc.part.package.parts.map(part => [part.partname.toString().slice(1), part.blob]));
  const output = outputKind === "sink" ? env.sink : { path: "/work/result", capability: env.vfs };
  const pending = part.save(output); expect(pending).toBeInstanceOf(Promise); await pending;
  const bytes = env.bytes(outputKind === "sink" ? "/work/output" : "/work/result"), after = readPackage(bytes);
  for (const [name, bytes] of before) expect(after.get(name), name).toEqual(bytes);
  expect((await api.Document(bytes, textContext)).paragraphs[0]!.text).toBe("Recorded shore — 波");
  expect(env.volume.readFileSync("/work/keep", "utf8")).toBe("unrelated");
  if (outputKind === "sink") expect(env.events.slice(-2)).toEqual(["close", "commit"]);
  else expect(env.fs.publishStagedFile).toHaveBeenCalledTimes(1);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const boundary of ["close-failure", "foreign-authority", "cancelled", "dry-run", "conflict"] as const)
it(`native DocumentPart.save preserves destinations at ${boundary}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Save boundary</w:t></w:r></w:p>');
  const env = saveFixture(), controller = new AbortController(), doc = await api.Document(input, { ...textContext, signal: controller.signal, vfs: env.vfs });
  const part = doc.part;
  if (boundary === "close-failure") {
    env.staged.close.mockRejectedValueOnce(new Error("closed output"));
    await expect(part.save(env.sink)).rejects.toMatchObject({ code: "sink-failure" }); expect(env.staged.abort).toHaveBeenCalledTimes(1); expect(env.staged.commit).not.toHaveBeenCalled();
  } else if (boundary === "foreign-authority") {
    const foreign = saveFixture();
    await expect(part.save({ path: "/work/result", capability: foreign.vfs })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(foreign.fs.createStagedFile).not.toHaveBeenCalled();
  } else if (boundary === "cancelled") {
    const reason = new Error("Caller cancelled publication"); controller.abort(reason); await expect(part.save(env.sink)).rejects.toMatchObject({ code: "cancelled" }); expect(env.sink.stage).not.toHaveBeenCalled();
  } else if (boundary === "dry-run") {
    await part.save(env.sink, { dryRun: true }); expect(env.sink.stage).not.toHaveBeenCalled();
  } else {
    await expect(part.save({ path: "/work/output", capability: env.vfs })).rejects.toMatchObject({ code: "conflict" }); expect(env.fs.publishStagedFile).not.toHaveBeenCalled();
  }
  expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous"); expect(env.volume.readFileSync("/work/keep", "utf8")).toBe("unrelated");
});
