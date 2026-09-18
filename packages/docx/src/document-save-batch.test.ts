import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { saveFixture } from "../tests/fixtures/save-output.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const enc = (text: string) => new TextEncoder().encode(text);
const prefixes = ["model.document.Document", "model.parts.document.DocumentPart", "model.package.Package", "model.opc.package.OpcPackage"] as const;
function workflow(prefix: typeof prefixes[number], path: string, mode: "save" | "repeat" | "late-failure" = "save") {
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.text.set", receiver: ref("paragraphs", 0), arguments: { value: "Saved shore — 波" } }
  ] as Record<string, unknown>[];
  const receiver = prefix === "model.document.Document" ? ref("document") : prefix === "model.parts.document.DocumentPart" ? ref("main") : ref("package");
  const save = { operation: `${prefix}.save.call`, receiver, arguments: { output: { path, capability: "command" } } };
  operations.push(save);
  if (mode === "repeat") operations.push(
    { operation: "model.text.paragraph.Paragraph.text.set", receiver: ref("paragraphs", 0), arguments: { value: "Saved again" } }, save);
  if (mode === "late-failure") operations.push({ operation: "model.text.paragraph.Paragraph.text.set", receiver: ref("paragraphs", 8), arguments: { value: "Must fail" } });
  return { version: 1, operations };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const prefix of prefixes) for (const route of ["model-batch", "sdk", "shell"] as const)
for (const mode of ["save", "repeat"] as const)
it(`${route} stages ${prefix}.save for one outer publication; mode=${mode}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Initial shore</w:t></w:r></w:p>');
  const batch = workflow(prefix, "/work/result", mode), expected = mode === "repeat" ? "Saved again" : "Saved shore — 波";
  let output: Uint8Array;
  if (route === "shell") {
    const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.writeFile("/work/input", input); await fs.writeFile("/work/ops", enc(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /work/input --ops-file /work/ops --output /work/result --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const data = JSON.parse(result.stdout); expect(data.data.results[4]).toMatchObject({ operation: `${prefix}.save.call`, ok: true, data: null });
      output = await fs.readFile("/work/result"); expect(await fs.readFile("/work/input")).toEqual(input);
    } finally { await shell.dispose(); }
  } else {
    const env = saveFixture(), context = { ...textContext, encoding: { order: "input", compression: "store" } as const, filesystem: env.fs, binaryResolver: { ...env.vfs, capability: "command" } };
    if (route === "model-batch") {
      const staged = await api.applyStyleModelBatch(input, batch, context);
      expect(env.fs.createStagedFile).not.toHaveBeenCalled(); expect(staged.results[4]!.value).toBeNull();
      await staged.publish({ output: "/work/result" }, context);
    } else await api.executeDocumentBatch(input, batch, { output: "/work/result" }, context);
    expect(env.fs.publishStagedFile).toHaveBeenCalledTimes(1); output = env.bytes("/work/result");
  }
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe(expected);
  const after = readPackage(output);
  for (const [name, bytes] of readPackage(input)) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const prefix of prefixes) for (const route of ["sdk", "shell"] as const)
for (const mode of ["different-destination", "late-failure"] as const)
it(`${route} refuses ${mode} after ${prefix}.save without publishing; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Initial shore</w:t></w:r></w:p>');
  const batch = workflow(prefix, mode === "different-destination" ? "/work/other" : "/work/output", mode === "late-failure" ? mode : "save");
  const code = mode === "late-failure" ? "missing-selection" : "usage";
  if (route === "sdk") {
    const env = saveFixture(), context = { ...textContext, encoding: { order: "input", compression: "store" } as const, filesystem: env.fs, binaryResolver: { ...env.vfs, capability: "command" } };
    await expect(api.executeDocumentBatch(input, batch, { output: "/work/output", force: true }, context)).rejects.toMatchObject({ code });
    expect(env.fs.createStagedFile).not.toHaveBeenCalled(); expect(env.fs.publishStagedFile).not.toHaveBeenCalled(); expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
  } else {
    const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.writeFile("/work/input", input); await fs.writeFile("/work/output", enc("previous")); await fs.writeFile("/work/ops", enc(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /work/input --ops-file /work/ops --output /work/output --force --json"); expect(result.exitCode).toBe(mode === "late-failure" ? 1 : 2);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code }] });
      expect(await fs.readFile("/work/output")).toEqual(enc("previous")); expect(await fs.readFile("/work/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
});

for (const boundary of ["caller-limit", "caller-cancellation"] as const)
it(`staged model save enforces ${boundary} before acquiring the destination`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", false, "docx", '<w:p/>');
  const env = saveFixture(), context = { ...textContext, encoding: { order: "input", compression: "store" } as const, filesystem: env.fs, binaryResolver: { ...env.vfs, capability: "command" } };
  const staged = await api.applyStyleModelBatch(input, workflow("model.document.Document", "/work/output"), context);
  const caller = new AbortController(); if (boundary === "caller-cancellation") caller.abort();
  await expect(staged.publish({ output: "/work/output", force: true }, { ...context, signal: caller.signal,
    encoding: { order: "input", compression: "store" }, ...(boundary === "caller-limit" ? { budget: new api.DocumentBudget({ serializedOutput: 1 }) } : {})
  })).rejects.toMatchObject({ code: boundary === "caller-limit" ? "limit-exceeded" : "cancelled" });
  expect(env.fs.createStagedFile).not.toHaveBeenCalled(); expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const prefix of prefixes) for (const route of ["sdk", "shell"] as const)
for (const mode of ["dry-run", "snapshot", "stdout", "copy"] as const)
it(`${route} honors ${mode} for ${prefix}.save; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Initial shore</w:t></w:r></w:p>');
  const batch = workflow(prefix, "/work/result");
  if (mode === "copy") batch.operations.splice(3, 1);
  if (mode === "snapshot") batch.operations.push({ operation: "model.text.paragraph.Paragraph.text.set", receiver: ref("paragraphs", 0), arguments: { value: "Later unsaved change" } });
  if (mode === "stdout") batch.operations[4]!.arguments = { output: { capability: "command" } };
  let output: Uint8Array | undefined;
  if (route === "sdk") {
    const env = saveFixture(), context = { ...textContext, filesystem: env.fs, stdout: env.sink, encoding: { order: "input", compression: "store" } as const, binaryResolver: { ...env.vfs, capability: "command" } };
    const data = await api.executeDocumentBatch(input, batch, mode === "dry-run" ? { dryRun: true } : { output: mode === "stdout" ? "-" : "/work/result" }, context);
    expect(data.publication?.dryRun).toBe(mode === "dry-run");
    if (mode === "dry-run") { expect(env.fs.createStagedFile).not.toHaveBeenCalled(); expect(env.sink.stage).not.toHaveBeenCalled(); }
    else output = env.bytes(mode === "stdout" ? "/work/output" : "/work/result");
  } else {
    const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.writeFile("/work/input", input); await fs.writeFile("/work/ops", enc(JSON.stringify(batch))); await fs.writeFile("/work/sentinel", enc("kept"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const suffix = mode === "dry-run" ? "--dry-run --json" : mode === "stdout" ? "--output - > /work/result" : "--output /work/result --json";
      const result = await shell.exec(`docx batch /work/input --ops-file /work/ops ${suffix}`); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      if (mode !== "dry-run") output = await fs.readFile("/work/result"); else expect(JSON.parse(result.stdout).data.publication.dryRun).toBe(true);
      expect(await fs.readFile("/work/sentinel")).toEqual(enc("kept")); expect(await fs.readFile("/work/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (output) {
    expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe(mode === "copy" ? "Initial shore" : "Saved shore — 波");
    const after = readPackage(output);
    for (const [name, bytes] of readPackage(input)) if (mode === "copy" || name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const prefix of prefixes) for (const target of ["path", "sink"] as const)
it(`model batch save result publishes through its matching native ${target}; operation=${prefix}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const env = saveFixture(), context = { ...textContext, binaryResolver: { ...env.vfs, capability: "command" } }, batch = workflow(prefix, "/work/result");
  if (target === "sink") batch.operations[4]!.arguments = { output: { capability: "command" } };
  const result = await api.applyStyleModelBatch(input, batch, context);
  await result.save(target === "sink" ? env.sink : { path: "/work/result", capability: "command" });
  expect((await api.Document(env.bytes(target === "sink" ? "/work/output" : "/work/result"), textContext)).paragraphs[0]!.text).toBe("Saved shore — 波");
});

for (const prefix of prefixes) for (const defect of ["unknown-token", "second-destination", "different-authority"] as const)
it(`batch ${prefix}.save rejects ${defect} without acquiring any output`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", false, "docx", '<w:p/>');
  const env = saveFixture(), foreign = saveFixture(), batch = workflow(prefix, "/work/output");
  if (defect === "unknown-token") batch.operations[4]!.arguments = { output: { path: "/work/output", capability: "foreign" } };
  if (defect === "second-destination") batch.operations.push({ ...batch.operations[4], arguments: { output: { path: "/work/other", capability: "command" } } });
  const context = { ...textContext, filesystem: defect === "different-authority" ? foreign.fs : env.fs, encoding: { order: "input", compression: "store" } as const, binaryResolver: { ...env.vfs, capability: "command" } };
  await expect(api.executeDocumentBatch(input, batch, { output: "/work/output", force: true }, context)).rejects.toMatchObject({ code: "usage" });
  for (const fixture of [env, foreign]) { expect(fixture.fs.createStagedFile).not.toHaveBeenCalled(); expect(fixture.volume.readFileSync("/work/output", "utf8")).toBe("previous"); }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const prefix of ["model.package.Package", "model.opc.package.OpcPackage"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} stages the independently opened ${prefix} owner; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Outer source</w:t></w:r></w:p>');
  const { input: secondary } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Admitted secondary source</w:t></w:r></w:p>');
  const batch = { version: 1, operations: [
    { operation: `${prefix}.open.call`, arguments: { pkgFile: { kind: "bytes", base64: Buffer.from(secondary).toString("base64") } }, resultHandle: "loaded" },
    { operation: `${prefix}.save.call`, receiver: ref("loaded"), arguments: { output: { path: "/work/result", capability: "command" } } }
  ] };
  let output: Uint8Array;
  if (route === "sdk") {
    const env = saveFixture(); await api.executeDocumentBatch(input, batch, { output: "/work/result" }, { ...textContext, filesystem: env.fs, encoding: { order: "input", compression: "store" }, binaryResolver: { ...env.vfs, capability: "command" } });
    output = env.bytes("/work/result"); expect(env.fs.publishStagedFile).toHaveBeenCalledTimes(1);
  } else {
    const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.writeFile("/work/input", input); await fs.writeFile("/work/ops", enc(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /work/input --ops-file /work/ops --output /work/result --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); output = await fs.readFile("/work/result"); expect(await fs.readFile("/work/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  expect(readPackage(output)).toEqual(readPackage(secondary));
});
