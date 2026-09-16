import { expect, it, vi } from "vitest";
import * as api from "./index.js";
import { saveFixture } from "../tests/fixtures/save-output.js";
import { textContext, textFixture, paragraph } from "../tests/fixtures/text.js";

// Untyped calls cover hostile runtime values; public-shell.cases.ts checks exported types.
type Save = { save(output: unknown, options?: { force?: boolean; inPlace?: boolean; dryRun?: boolean }): Promise<void> };
const create = async (env = saveFixture(), signal = new AbortController().signal) => {
  const document = await api.Document(await textFixture(paragraph("Original coastal ledger")), { ...textContext, signal, vfs: env.vfs });
  return { ...env, document, model: document as unknown as Save };
};

it("saves staged bytes, closes before commit, and reloads an actual valid document", async () => {
  const env = await create();
  const pending = env.model.save(env.sink);
  expect(pending).toBeInstanceOf(Promise);
  await pending;
  expect((await api.Document(env.bytes())).paragraphs[0]!.text).toBe("Original coastal ledger");
  expect(env.events[0]).toBe("stage");
  expect(env.events.slice(-2)).toEqual(["close", "commit"]);
  expect(env.staged.abort).not.toHaveBeenCalled();
  expect(env.staged.write.mock.calls.every(([chunk]) => chunk.length <= textContext.limits.chunkSize)).toBe(true);
});

it.each(["write", "close", "commit"] as const)("aborts owned staging after %s failure and preserves the destination", async method => {
  const env = await create();
  env.staged[method].mockImplementationOnce(async () => { throw new Error("private failure"); });
  await expect(env.model.save(env.sink)).rejects.toMatchObject({ code: "sink-failure", published: [], stdoutMayBePartial: false });
  expect(env.staged.abort).toHaveBeenCalledTimes(1);
  expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
  expect(env.volume.existsSync("/work/stage")).toBe(false);
});

it("awaits failed abort, retaining the write failure as the primary cause", async () => {
  const env = await create(), failure = new Error("write failed"), cleanup = new Error("abort failed");
  env.staged.write.mockImplementationOnce(async chunk => { env.volume.appendFileSync("/work/stage", chunk.subarray(0, 3)); throw failure; });
  env.staged.abort.mockRejectedValueOnce(cleanup);
  await expect(env.model.save(env.sink)).rejects.toMatchObject({ code: "sink-failure", cause: failure, cleanupError: cleanup });
  expect(env.staged.abort).toHaveBeenCalledTimes(1);
  expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
});

it("does not abort staging it failed to acquire", async () => {
  const env = await create();
  env.sink.stage.mockRejectedValueOnce(new Error("no acquisition"));
  await expect(env.model.save(env.sink)).rejects.toMatchObject({ code: "sink-failure" });
  expect(env.staged.abort).not.toHaveBeenCalled();
});

it.each(["stage", "write", "close"] as const)("settles cancellation during %s before commit", async method => {
  const controller = new AbortController(), env = await create(saveFixture(), controller.signal);
  if (method === "stage") env.sink.stage.mockImplementationOnce(async () => { controller.abort(); return env.staged; });
  else env.staged[method].mockImplementationOnce(async () => { controller.abort(); });
  await expect(env.model.save(env.sink)).rejects.toMatchObject({ code: "cancelled", published: [] });
  expect(env.staged.commit).not.toHaveBeenCalled();
  expect(env.staged.abort).toHaveBeenCalledTimes(1);
});

it("honors a completed commit receipt even when cancellation arrives in commit", async () => {
  const controller = new AbortController(), env = await create(saveFixture(), controller.signal);
  env.staged.commit.mockImplementationOnce(async () => { env.volume.renameSync("/work/stage", "/work/output"); controller.abort(); });
  await env.model.save(env.sink);
  expect((await api.Document(env.bytes())).paragraphs).toHaveLength(1);
  expect(env.staged.abort).not.toHaveBeenCalled();
});

it("rejects mutation overtaking serialization before acquiring a sink", async () => {
  const env = await create();
  const pending = env.model.save(env.sink);
  env.document.add_paragraph("Later revision");
  await expect(pending).rejects.toMatchObject({ code: "conflict" });
  expect(env.sink.stage).not.toHaveBeenCalled();
});

it.each(["stage", "write", "close", "commit"] as const)("holds the model mutation guard across %s and releases it after save", async method => {
  const env = await create(), attempt = () => expect(() => env.document.add_paragraph("Forbidden")).toThrow(api.PublicationError);
  if (method === "stage") { const previous = env.sink.stage.getMockImplementation()!; env.sink.stage.mockImplementationOnce(async signal => { attempt(); return previous(signal); }); }
  else if (method === "write") { const previous = env.staged.write.getMockImplementation()!; env.staged.write.mockImplementationOnce(async chunk => { attempt(); await previous(chunk); }); }
  else { const previous = env.staged[method].getMockImplementation()!; env.staged[method].mockImplementationOnce(async () => { attempt(); await previous(); }); }
  await env.model.save(env.sink);
  env.document.add_paragraph("After save");
  expect((await api.Document(env.bytes())).paragraphs).toHaveLength(1);
});

it("saves and reopens a VFS document, with explicit collision and in-place intent", async () => {
  const env = await create();
  await env.model.save({ path: "/work/new", capability: env.vfs });
  const reopened = await api.Document({ path: "/work/new", capability: env.vfs }, { ...textContext, vfs: env.vfs });
  expect(reopened.paragraphs[0]!.text).toBe("Original coastal ledger");
  reopened.paragraphs[0]!.text = "Updated ledger";
  await expect((reopened as unknown as Save).save({ path: "/work/new", capability: env.vfs }, { force: true })).rejects.toMatchObject({ code: "conflict" });
  await (reopened as unknown as Save).save({ path: "/work/new", capability: env.vfs }, { inPlace: true });
  expect((await api.Document(env.bytes("/work/new"))).paragraphs[0]!.text).toBe("Updated ledger");
  await expect(env.model.save({ path: "/work/output", capability: env.vfs })).rejects.toMatchObject({ code: "conflict" });
  await env.model.save({ path: "/work/output", capability: env.vfs }, { force: true });
  expect((await api.Document(env.bytes())).paragraphs).toHaveLength(1);
});

it("rejects hard-link input aliases and stale in-place sources without damaging either", async () => {
  const env = saveFixture(); env.volume.writeFileSync("/work/input", await textFixture(paragraph("Source")));
  const model = await api.Document({ path: "/work/input", capability: env.vfs }, { ...textContext, vfs: env.vfs }) as unknown as Save;
  env.volume.linkSync("/work/input", "/work/alias");
  await expect(model.save({ path: "/work/alias", capability: env.vfs }, { force: true })).rejects.toMatchObject({ code: "conflict" });
  env.volume.writeFileSync("/work/input", "external replacement");
  await expect(model.save({ path: "/work/input", capability: env.vfs }, { inPlace: true })).rejects.toMatchObject({ code: "conflict" });
  expect(env.volume.readFileSync("/work/alias", "utf8")).toBe("external replacement");
});

it("rejects foreign authority and bare host paths without invoking the capability", async () => {
  const env = await create(), foreign = saveFixture();
  await expect(env.model.save({ path: "/work/new", capability: foreign.vfs })).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(env.model.save("/tmp/ungranted.docx")).rejects.toMatchObject({ code: "usage" });
  expect(env.fs.createStagedFile).not.toHaveBeenCalled(); expect(foreign.fs.createStagedFile).not.toHaveBeenCalled();
});

it("preserves a concurrent winner using conditional publication and cleans only its stage", async () => {
  const env = await create(), publish = env.fs.publishStagedFile!;
  vi.mocked(env.fs.publishStagedFile!).mockImplementationOnce(async (...args) => {
    env.volume.writeFileSync("/work/new", "winner"); await publish(...args);
  });
  await expect(env.model.save({ path: "/work/new", capability: env.vfs })).rejects.toMatchObject({ code: "conflict", published: [] });
  expect(env.volume.readFileSync("/work/new", "utf8")).toBe("winner");
  expect(env.volume.readdirSync("/work").sort()).toEqual(["keep", "new", "output"]);
});

it("rejects incapable VFS adapters and settles cleanup failure after a real commit", async () => {
  const env = await create();
  vi.mocked(env.fs.capabilitiesFor!).mockResolvedValueOnce({ atomicFileStaging: false });
  await expect(env.model.save({ path: "/work/new", capability: env.vfs })).rejects.toMatchObject({ code: "unsupported-publication" });
  vi.mocked(env.fs.removeStagedFile!).mockRejectedValueOnce(new Error("cleanup failed"));
  await expect(env.model.save({ path: "/work/new", capability: env.vfs })).rejects.toMatchObject({ code: "sink-failure", published: [{ path: "/work/new" }] });
  expect((await api.Document(env.bytes("/work/new"))).paragraphs).toHaveLength(1);
});

it("retains ArchiveSink borrowing and rejects ambiguous output forms without evaluating accessors", async () => {
  const env = await create(), write = vi.fn(async (_bytes: Uint8Array) => {}), close = vi.fn(), getter = vi.fn(() => write);
  await env.model.save({ write, close }); expect(close).not.toHaveBeenCalled();
  await expect(env.model.save({ write, stage: env.sink.stage })).rejects.toMatchObject({ code: "usage" });
  await expect(env.model.save(Object.defineProperty({}, "write", { get: getter }))).rejects.toMatchObject({ code: "usage" });
  expect(getter).not.toHaveBeenCalled();
});

it("keeps the model locked when an overlapping publication finishes first", async () => {
  const env = await create(), other = saveFixture();
  let entered!: () => void, resume!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  env.staged.close.mockImplementationOnce(async () => { entered(); await waiting; });
  const pending = env.model.save(env.sink);
  await started;
  try {
    await expect(env.model.save(other.sink)).rejects.toMatchObject({ code: "conflict" });
    expect(() => env.document.add_paragraph("Must remain locked")).toThrow(api.PublicationError);
  } finally { resume(); await pending; }
});

it("retains both conditional publication and owned cleanup failures", async () => {
  const env = await create(), primary = Object.assign(new Error("collision"), { code: "EAGAIN" }), cleanup = new Error("remove failed");
  vi.mocked(env.fs.publishStagedFile!).mockRejectedValueOnce(primary);
  vi.mocked(env.fs.removeStagedFile!).mockRejectedValueOnce(cleanup);
  await expect(env.model.save({ path: "/work/output", capability: env.vfs }, { force: true }))
    .rejects.toMatchObject({ code: "conflict", cause: primary, cleanupError: cleanup, published: [] });
  expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
});

it.each(["document", "package", "styles"] as const)("uses both required outputs through the %s owner", async owner => {
  const env = saveFixture(), input = await textFixture(paragraph("Owner content"));
  const context = { ...textContext, vfs: env.vfs };
  const target = owner === "document" ? await api.Document(input, context)
    : owner === "package" ? await api.PackageView.open(input, context) : await api.openDocumentStyleModel(input, context);
  await (target as unknown as Save).save(env.sink);
  await (target as unknown as Save).save({ path: "/work/path", capability: env.vfs });
  for (const bytes of [env.bytes(), env.bytes("/work/path")])
    expect((await api.Document(bytes)).paragraphs[0]!.text).toBe("Owner content");
});

it.each(["package", "styles"] as const)("retains source identity in VFS %s admission", async owner => {
  const env = saveFixture(); env.volume.writeFileSync("/work/input", await textFixture(paragraph("Source")));
  const input = { path: "/work/input", capability: env.vfs }, context = { ...textContext, vfs: env.vfs };
  const model = owner === "package" ? await api.PackageView.open(input, context) : await api.openDocumentStyleModel(input, context);
  await expect((model as unknown as Save).save(input, { force: true })).rejects.toMatchObject({ code: "conflict" });
  await (model as unknown as Save).save(input, { inPlace: true });
  expect((await api.Document(env.bytes(input.path))).paragraphs[0]!.text).toBe("Source");
});

it("supports trusted VFS tokens only with a matching publication resolver", async () => {
  const env = saveFixture(), resolver = { ...env.vfs, capability: "workspace" };
  const model = await api.Document(await textFixture(paragraph("Token content")), { ...textContext, binaryResolver: resolver }) as unknown as Save;
  await expect(model.save({ path: "/work/new", capability: "foreign" })).rejects.toMatchObject({ code: "unsupported-edit" });
  await model.save({ path: "/work/new", capability: "workspace" });
  expect((await api.Document({ path: "/work/new", capability: "workspace" }, { ...textContext, binaryResolver: resolver })).paragraphs[0]!.text).toBe("Token content");
});

it.each(["/work/../escape", "relative", "/work\\escape", "/work/line\nbreak", "/work//extra"])("rejects noncanonical VFS output %j before I/O", async path => {
  const env = await create();
  await expect(env.model.save({ path, capability: env.vfs })).rejects.toBeInstanceOf(api.InvalidValueError);
  expect(env.fs.lstat).not.toHaveBeenCalled();
});

it("refuses read-only authority, unknown alias identity, and path byte overflow", async () => {
  const env = saveFixture(); env.volume.writeFileSync("/work/input", await textFixture(paragraph("Source")));
  const input = { path: "/work/input", capability: env.vfs };
  const model = await api.Document(input, { ...textContext, vfs: env.vfs }) as unknown as Save;
  vi.mocked(env.fs.capabilitiesFor!).mockResolvedValueOnce({ readOnly: true });
  await expect(model.save({ path: "/work/new", capability: env.vfs })).rejects.toMatchObject({ code: "permission" });
  vi.mocked(env.fs.compareEntry!).mockResolvedValueOnce("unknown");
  await expect(model.save({ path: "/work/output", capability: env.vfs }, { force: true })).rejects.toMatchObject({ code: "unsupported-publication" });
  await expect(model.save({ path: "/" + "é".repeat(130), capability: env.vfs })).rejects.toBeInstanceOf(api.ResourceLimitError);
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it.each(["stage", "commit"] as const)("settles VFS cancellation during %s with authoritative receipts", async method => {
  const controller = new AbortController(), env = await create(saveFixture(), controller.signal);
  const key = method === "stage" ? "createStagedFile" : "publishStagedFile";
  if (key === "createStagedFile") {
    const implementation = vi.mocked(env.fs.createStagedFile!).getMockImplementation()!;
    vi.mocked(env.fs.createStagedFile!).mockImplementationOnce(async (...args) => { const stage = await implementation(...args); controller.abort(); return stage; });
    await expect(env.model.save({ path: "/work/new", capability: env.vfs })).rejects.toMatchObject({ code: "cancelled", published: [] });
    expect(env.volume.existsSync("/work/new")).toBe(false);
  } else {
    const implementation = vi.mocked(env.fs.publishStagedFile!).getMockImplementation()!;
    vi.mocked(env.fs.publishStagedFile!).mockImplementationOnce(async (...args) => { await implementation(...args); controller.abort(); });
    await env.model.save({ path: "/work/new", capability: env.vfs });
    expect((await api.Document(env.bytes("/work/new"))).paragraphs).toHaveLength(1);
  }
  expect(env.fs.removeStagedFile).toHaveBeenCalledTimes(1);
});

it("aborts a VFS save overtaken during staging and rejects mutation during commit", async () => {
  const env = await create(), createStage = vi.mocked(env.fs.createStagedFile!).getMockImplementation()!;
  vi.mocked(env.fs.createStagedFile!).mockImplementationOnce(async (...args) => { env.document.add_paragraph("Later"); return createStage(...args); });
  await expect(env.model.save({ path: "/work/new", capability: env.vfs })).rejects.toMatchObject({ code: "conflict" });
  expect(env.volume.existsSync("/work/new")).toBe(false);
  const commit = vi.mocked(env.fs.publishStagedFile!).getMockImplementation()!;
  vi.mocked(env.fs.publishStagedFile!).mockImplementationOnce(async (...args) => { expect(() => env.document.add_paragraph("Forbidden")).toThrow(api.PublicationError); return commit(...args); });
  await env.model.save({ path: "/work/new", capability: env.vfs });
  expect((await api.Document(env.bytes("/work/new"))).paragraphs).toHaveLength(2);
});

it.each(["sink", "path"] as const)("validates dry runs and refuses protected %s output before acquisition", async kind => {
  const env = await create(), target = kind === "sink" ? env.sink : { path: "/work/new", capability: env.vfs };
  await env.model.save(target, { dryRun: true });
  expect(env.sink.stage).not.toHaveBeenCalled(); expect(env.fs.createStagedFile).not.toHaveBeenCalled();
  const locked = await api.Document(await textFixture('<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>Protected</w:t></w:r></w:sdtContent></w:sdt></w:p>'), { ...textContext, vfs: env.vfs }) as unknown as Save;
  await expect(locked.save(target)).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(env.sink.stage).not.toHaveBeenCalled(); expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it("reserves bounded output before staging and aborts malformed acquired stages", async () => {
  const env = await create();
  const limited = await api.Document(await textFixture(paragraph("Budgeted")), { limits: { serializedOutput: 32 } }) as unknown as Save;
  await expect(limited.save(env.sink)).rejects.toBeInstanceOf(api.ResourceLimitError);
  expect(env.sink.stage).not.toHaveBeenCalled();
  env.sink.stage.mockResolvedValueOnce({ abort: env.staged.abort } as never);
  await expect(env.model.save(env.sink)).rejects.toMatchObject({ code: "sink-failure" });
  expect(env.staged.abort).toHaveBeenCalledTimes(1);
});

it("captures sink methods and path options before external awaits", async () => {
  const env = await create(), original = env.sink.stage;
  const pending = env.model.save(env.sink);
  env.sink.stage = vi.fn(async () => { throw new Error("replaced method"); });
  await pending;
  expect(original).toHaveBeenCalledTimes(1);
  const target = { path: "/work/new", capability: env.vfs }, options = { force: false };
  const pathSave = env.model.save(target, options);
  target.path = "/work/output"; options.force = true;
  await pathSave;
  expect(env.volume.existsSync("/work/new")).toBe(true);
});

it.each(["success", "collision", "alias", "dry-run", "binary", "failure"] as const)("matches CLI publication behavior for %s", async scenario => {
  const input = await textFixture(paragraph("Source")), sdk = saveFixture(), cli = saveFixture();
  for (const env of [sdk, cli]) env.volume.writeFileSync("/work/input", input);
  const document = await api.Document({ path: "/work/input", capability: sdk.vfs }, { ...textContext, vfs: sdk.vfs });
  document.add_paragraph("Added via public model");
  const batch = { version: 1, operations: [{ operation: "model.document.Document.add_paragraph.call", receiver: { resultHandle: "document" }, arguments: { text: "Added via public model" } }] };
  const output = scenario === "collision" || scenario === "failure" ? "/work/output" : scenario === "alias" ? "/work/input" : "/work/new";
  const flags = scenario === "dry-run" ? ["--dry-run", "--json"] : scenario === "alias" || scenario === "failure" ? ["--force", "--json"] : scenario === "binary" ? [] : ["--json"];
  if (scenario === "failure") for (const env of [sdk, cli]) vi.mocked(env.fs.publishStagedFile!).mockRejectedValueOnce(new Error("private transport failure"));
  const target = scenario === "binary" ? sdk.sink : { path: output, capability: sdk.vfs };
  const expectedCode = scenario === "collision" || scenario === "alias" ? "conflict" : scenario === "failure" ? "sink-failure" : undefined;
  const save = (document as unknown as Save).save(target, { force: scenario === "alias" || scenario === "failure", dryRun: scenario === "dry-run" });
  if (expectedCode) await expect(save).rejects.toMatchObject({ code: expectedCode }); else await save;
  cli.volume.writeFileSync("/stdout", "");
  let stderr = "";
  const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/work/input", "--ops-json", JSON.stringify(batch), "--output", scenario === "binary" ? "-" : output, ...flags].map(value => new TextEncoder().encode(value)),
    cwd: "/work", signal: textContext.signal,
    filesystem: { ...cli.fs, async readFile(path) { return cli.bytes(path); }, async realpath(path) { return String(cli.volume.realpathSync(path)); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { cli.volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode, stderr).toBe(expectedCode === "conflict" ? 1 : expectedCode ? 3 : 0);
  if (expectedCode) expect(JSON.parse(cli.volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({ ok: false, affected: 0, errors: [{ code: expectedCode }] });
  else if (scenario !== "dry-run") {
    const sdkBytes = sdk.bytes(scenario === "binary" ? "/work/output" : output), cliBytes = cli.bytes(scenario === "binary" ? "/stdout" : output);
    expect(cliBytes).toEqual(sdkBytes);
    expect((await api.Document(cliBytes)).paragraphs.map(p => p.text)).toEqual(["Source", "Added via public model"]);
  }
  for (const env of [sdk, cli]) {
    expect(env.bytes("/work/input")).toEqual(input);
    expect(env.volume.readFileSync("/work/keep", "utf8")).toBe("unrelated");
    if (expectedCode || scenario === "dry-run") expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
  }
});

it("commits the required three-method stage without a close extension", async () => {
  const env = await create();
  env.sink.stage.mockImplementationOnce(async () => { env.volume.writeFileSync("/work/stage", ""); return { write: env.staged.write, commit: env.staged.commit, abort: env.staged.abort } as never; });
  await env.model.save(env.sink);
  expect((await api.Document(env.bytes())).paragraphs[0]!.text).toBe("Original coastal ledger");
  expect(env.staged.close).not.toHaveBeenCalled();
});

it("never removes a foreign staging collision", async () => {
  const env = await create();
  vi.mocked(env.fs.createStagedFile!).mockImplementationOnce(async directory => {
    env.volume.mkdirSync(directory); env.volume.writeFileSync(`${directory}/foreign`, "other owner");
    throw Object.assign(new Error("stage collision"), { code: "EEXIST" });
  });
  await expect(env.model.save({ path: "/work/new", capability: env.vfs })).rejects.toMatchObject({ code: "conflict" });
  expect(env.fs.removeStagedFile).not.toHaveBeenCalled();
  const foreign = Object.keys(env.volume.toJSON()).find(path => path.endsWith("/foreign"))!;
  expect(env.volume.readFileSync(foreign, "utf8")).toBe("other owner");
});

it("rejects input mutation during VFS acquisition", async () => {
  const env = saveFixture(); env.volume.writeFileSync("/work/input", await textFixture(paragraph("First")));
  env.vfs.open.mockImplementationOnce(() => ({ async *[Symbol.asyncIterator]() {
    const bytes = env.bytes("/work/input");
    env.volume.writeFileSync("/work/input", "changed while reading");
    yield bytes;
  } }));
  await expect(api.Document({ path: "/work/input", capability: env.vfs }, { ...textContext, vfs: env.vfs })).rejects.toMatchObject({ code: "conflict" });
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it.each(["sink", "path"] as const)("rejects cancellation before %s save without acquiring output", async kind => {
  const controller = new AbortController(), env = await create(saveFixture(), controller.signal);
  controller.abort();
  await expect(env.model.save(kind === "sink" ? env.sink : { path: "/work/new", capability: env.vfs })).rejects.toBeInstanceOf(api.CancellationError);
  expect(env.sink.stage).not.toHaveBeenCalled(); expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it("validates conflicting save flags without invoking output callbacks", async () => {
  const env = await create();
  for (const flags of [{ force: true }, { inPlace: true }, { force: "yes" }, { output: "/work/new" }])
    await expect(env.model.save(env.sink, flags as never)).rejects.toBeInstanceOf(api.InputTypeError);
  await expect(env.model.save({ path: "/work/new", capability: env.vfs }, { inPlace: true })).rejects.toMatchObject({ code: "conflict" });
  expect(env.sink.stage).not.toHaveBeenCalled(); expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it("settles an asynchronous abort before rejecting and keeps the model locked until it settles", async () => {
  const env = await create();
  let entered!: () => void, resume!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<void>(resolve => { resume = resolve; });
  env.staged.write.mockRejectedValueOnce(new Error("write failed"));
  env.staged.abort.mockImplementationOnce(async () => { entered(); await waiting; env.volume.rmSync("/work/stage"); });
  let settled = false;
  const pending = env.model.save(env.sink).catch(error => { settled = true; throw error; });
  await started;
  expect(settled).toBe(false);
  expect(() => env.document.add_paragraph("Forbidden")).toThrow(api.PublicationError);
  resume();
  await expect(pending).rejects.toMatchObject({ code: "sink-failure" });
  env.document.add_paragraph("After settlement");
});

it("retains prototype-method ArchiveSink compatibility without invoking accessors", async () => {
  const env = await create();
  class Borrowed {
    async write(bytes: Uint8Array) { env.volume.writeFileSync("/work/output", bytes); }
    async close() { throw new Error("Borrowed close must not be called"); }
  }
  await env.model.save(new Borrowed());
  expect((await api.Document(env.bytes())).paragraphs[0]!.text).toBe("Original coastal ledger");
});

it("admits class-based staged capabilities with privately owned state", async () => {
  const env = await create();
  class Stage {
    #closed = false;
    async write(bytes: Uint8Array) { expect(this.#closed).toBe(false); env.volume.appendFileSync("/work/stage", bytes); }
    async close() { this.#closed = true; }
    async commit() { expect(this.#closed).toBe(true); env.volume.renameSync("/work/stage", "/work/output"); }
    async abort() { env.volume.rmSync("/work/stage", { force: true }); }
  }
  class Sink {
    async stage() { env.volume.writeFileSync("/work/stage", ""); return new Stage(); }
  }
  await env.model.save(new Sink());
  expect((await api.Document(env.bytes())).paragraphs[0]!.text).toBe("Original coastal ledger");
});

it("classifies cancellation even when the staged adapter rejects with a publication error", async () => {
  const controller = new AbortController(), env = await create(saveFixture(), controller.signal);
  env.staged.write.mockImplementationOnce(async () => { controller.abort(); throw new api.PublicationError("sink-failure", "adapter stopped"); });
  await expect(env.model.save(env.sink)).rejects.toMatchObject({ code: "cancelled", published: [] });
  expect(env.staged.abort).toHaveBeenCalledTimes(1);
});
