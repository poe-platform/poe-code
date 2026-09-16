import { expect, it, vi } from "vitest";
import * as api from "./index.js";
import { saveFixture } from "../tests/fixtures/save-output.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

it.each((["document", "package", "styles"] as const).flatMap(owner => [true, false].map(dryRun => ({ owner, dryRun }))))("protects the admitted input inode after its pathname changes through $owner save, dry-run $dryRun", async ({ owner, dryRun }) => {
  const env = saveFixture(), original = await textFixture(paragraph("Original inlet record"));
  env.volume.writeFileSync("/work/input", original);
  env.volume.linkSync("/work/input", "/work/alias");
  const input = { path: "/work/input", capability: env.vfs }, context = { ...textContext, vfs: env.vfs };
  const model = owner === "document" ? await api.Document(input, context)
    : owner === "package" ? await api.PackageView.open(input, context) : await api.openDocumentStyleModel(input, context);
  env.volume.unlinkSync(input.path);
  env.volume.writeFileSync(input.path, "new owner of the input path");
  await expect(model.save({ path: "/work/alias", capability: env.vfs }, { force: true, dryRun }))
    .rejects.toMatchObject({ code: "conflict", published: [] });
  expect(env.bytes("/work/alias")).toEqual(original);
  expect(env.volume.readFileSync(input.path, "utf8")).toBe("new owner of the input path");
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it("protects admitted input aliases through shared extraction publication", async () => {
  const env = saveFixture(), original = await textFixture(paragraph("Extract source"));
  env.volume.writeFileSync("/work/input", original);
  env.volume.linkSync("/work/input", "/work/alias");
  const input = { path: "/work/input", stat: await env.stat("/work/input") };
  env.volume.unlinkSync(input.path); env.volume.writeFileSync(input.path, "replacement");
  await expect(api.publishDocumentFiles([{ path: "/work/alias", bytes: new TextEncoder().encode("Extracted text") }], { input, force: true }, { ...textContext, filesystem: env.fs }))
    .rejects.toMatchObject({ code: "conflict", published: [] });
  expect(env.bytes("/work/alias")).toEqual(original);
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it.each([true, false])("retains admitted alias protection in CLI publication with dry-run %s", async dryRun => {
  const env = saveFixture(), original = await textFixture(paragraph("CLI inlet record"));
  env.volume.writeFileSync("/work/input", original);
  env.volume.linkSync("/work/input", "/work/alias");
  const capabilities = vi.mocked(env.fs.capabilitiesFor!).getMockImplementation()!;
  vi.mocked(env.fs.capabilitiesFor!).mockImplementationOnce(async (...args) => {
    env.volume.unlinkSync("/work/input");
    env.volume.writeFileSync("/work/input", "replacement during destination admission");
    return capabilities(...args);
  });
  let stdout = "", stderr = "";
  const batch = { version: 1, operations: [{ operation: "model.document.Document.add_paragraph.call",
    receiver: { resultHandle: "document" }, arguments: { text: "Pending addition" } }] };
  const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/work/input", "--ops-json", JSON.stringify(batch), "--output", "/work/alias", "--force", "--json", ...(dryRun ? ["--dry-run"] : [])].map(s => new TextEncoder().encode(s)),
    cwd: "/work", signal: textContext.signal,
    filesystem: { ...env.fs, async readFile(path) { return env.bytes(path); }, async realpath(path) { return String(env.volume.realpathSync(path)); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode, stderr).toBe(1);
  expect(JSON.parse(stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "conflict" }] });
  expect(env.bytes("/work/alias")).toEqual(original);
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it("does not equate inode numbers from different identity scopes", async () => {
  const env = saveFixture(), original = await textFixture(paragraph("Independent output"));
  env.volume.writeFileSync("/work/input", original);
  const stat = await env.stat("/work/input");
  const archive = await api.readDocumentArchive(original, textContext);
  // The adapter proves the current entries distinct; an unrelated namespace can reuse inode numbers.
  const outputStat = await env.stat("/work/output");
  await api.publishDocumentArchive(archive, { input: { path: "/work/input", stat: { ...stat, ino: outputStat.ino!, dev: outputStat.dev!, identityScope: {} } }, output: "/work/output", force: true },
    { ...textContext, filesystem: env.fs, encoding: { order: "input", compression: "store" } });
  expect((await api.Document(env.bytes())).paragraphs[0]!.text).toBe("Independent output");
  expect(env.bytes("/work/input")).toEqual(original);
});

it("refuses replacement when a retargeted input symlink lacks an admitted file identity", async () => {
  const env = saveFixture(), original = await textFixture(paragraph("Symlink source"));
  env.volume.writeFileSync("/work/original", original);
  env.volume.writeFileSync("/work/replacement", "unrelated target");
  env.volume.symlinkSync("/work/original", "/work/input");
  const model = await api.Document({ path: "/work/input", capability: env.vfs }, { ...textContext, vfs: env.vfs });
  env.volume.unlinkSync("/work/input");
  env.volume.symlinkSync("/work/replacement", "/work/input");
  await expect(model.save({ path: "/work/original", capability: env.vfs }, { force: true }))
    .rejects.toMatchObject({ code: "unsupported-publication", published: [] });
  expect(env.bytes("/work/original")).toEqual(original);
  expect(env.volume.readFileSync("/work/input", "utf8")).toBe("unrelated target");
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
  // An exclusively created new entry cannot overwrite the original source alias.
  await model.save({ path: "/work/new", capability: env.vfs });
  expect((await api.Document(env.bytes("/work/new"))).paragraphs[0]!.text).toBe("Symlink source");
});

it("retains conflict classification for a proven current symlink input alias", async () => {
  const env = saveFixture(), original = await textFixture(paragraph("Current symlink alias"));
  env.volume.writeFileSync("/work/original", original);
  env.volume.symlinkSync("/work/original", "/work/input");
  const model = await api.Document({ path: "/work/input", capability: env.vfs }, { ...textContext, vfs: env.vfs });
  await expect(model.save({ path: "/work/original", capability: env.vfs }, { force: true }))
    .rejects.toMatchObject({ code: "conflict", published: [] });
  expect(env.bytes("/work/original")).toEqual(original);
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it("refuses replacement without a scoped admitted input identity", async () => {
  const env = saveFixture(), original = await textFixture(paragraph("Unscoped source"));
  env.volume.writeFileSync("/work/input", original);
  const lstat = vi.mocked(env.fs.lstat!).getMockImplementation()!;
  vi.mocked(env.fs.lstat!).mockImplementation(async (...args) => {
    const result = await lstat(...args);
    if (args[0] !== "/work/input") return result;
    const { identityScope: ignoredScope, ...unscoped } = result;
    return unscoped;
  });
  const model = await api.Document({ path: "/work/input", capability: env.vfs }, { ...textContext, vfs: env.vfs });
  // Identity becoming available later cannot authenticate the bytes already admitted.
  vi.mocked(env.fs.lstat!).mockImplementation(lstat);
  await expect(model.save({ path: "/work/output", capability: env.vfs }, { force: true }))
    .rejects.toMatchObject({ code: "unsupported-publication", published: [] });
  expect(env.bytes("/work/input")).toEqual(original);
  expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});

it.each(["symlink", "directory"])("refuses a %s destination even with force", async kind => {
  const env = saveFixture(), original = await textFixture(paragraph("Entry types"));
  const model = await api.Document(original, { ...textContext, vfs: env.vfs });
  if (kind === "symlink") env.volume.symlinkSync("/work/output", "/work/target");
  else env.volume.mkdirSync("/work/target");
  await expect(model.save({ path: "/work/target", capability: env.vfs }, { force: true })).rejects.toMatchObject({ code: "conflict" });
  expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
  expect(env.fs.createStagedFile).not.toHaveBeenCalled();
});
