import { expect, test } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createDiffpdfCommand, diffpdfCommands, type DiffpdfCommandsOptions } from "./index.js";

function pdf(text: string, x = 10) {
  const doc = PdfDocument.create(); doc.addPage([100, 100]).drawText(text, { x, y: 50, size: 10 }); return doc.save();
}
async function compare(a: Uint8Array, b: Uint8Array, args = ["a.pdf", "b.pdf"], options: DiffpdfCommandsOptions = {}, signal = new AbortController().signal) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.pdf", a); await fs.writeFile("/b.pdf", b);
  let stdout = ""; let stderr = "";
  const result = await createDiffpdfCommand(options).execute({ command: "diffpdf", args: createCommandArguments(args).args,
    cwd: "/", env: {}, fs, signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  return { ...result, stdout, stderr };
}

test("detects interior word movement without changing text or outer line bounds", async () => {
  const make = (middle: number) => {
    const doc = PdfDocument.create(); const page = doc.addPage([100, 100]);
    for (const [text, x] of [["A", 10], ["B", middle], ["C", 70]] as const) page.drawText(text, { x, y: 50, size: 10 });
    return doc.save();
  };
  expect((await compare(make(30), make(40))).exitCode).toBe(0);
  expect((await compare(make(30), make(40), ["--layout", "a.pdf", "b.pdf"])).exitCode).toBe(1);
});

test("reports extra and missing blank pages", async () => {
  const a = PdfDocument.create(); a.addPage([100, 100]);
  const b = PdfDocument.create(); b.addPage([100, 100]); b.addPage([100, 100]);
  for (const [old, next] of [[a, b], [b, a]]) {
    expect(await compare(old!.save(), next!.save())).toMatchObject({ exitCode: 1, stdout: "Page 2 differs (text)\n" });
  }
});

test("layout detects page size and rotation even on blank pages", async () => {
  const original = PdfDocument.create(); original.addPage([100, 100]);
  const changed = PdfDocument.create(); const page = changed.addPage([100, 100]); page.setRotation(90);
  expect((await compare(original.save(), changed.save())).exitCode).toBe(0);
  expect((await compare(original.save(), changed.save(), ["--layout", "a.pdf", "b.pdf"])).exitCode).toBe(1);
  page.setRotation(0); page.setSize(100, 200);
  expect((await compare(original.save(), changed.save(), ["--layout", "a.pdf", "b.pdf"])).exitCode).toBe(1);
});

test("malformed PDFs return an error distinct from differences", async () => {
  const result = await compare(new TextEncoder().encode("not a PDF"), pdf("valid"));
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("diffpdf:");
  expect(result.stdout).toBe("");
});

test.each([["--invalid", "a.pdf", "b.pdf"], [], ["a.pdf"], ["a.pdf", "b.pdf", "c.pdf"]])("rejects invalid invocation %j", async (...args) => {
  expect(await compare(new Uint8Array(), new Uint8Array(), args)).toMatchObject({ exitCode: 2, stdout: "" });
});

test("help does not read PDFs", async () => {
  expect(await compare(new Uint8Array(), new Uint8Array(), ["--help"])).toMatchObject({ exitCode: 0, stderr: "" });
});

test("bounds combined input and page count", async () => {
  const bytes = pdf("limits");
  await expect(compare(bytes, bytes, undefined, { limits: { maxInputBytes: bytes.length } })).rejects.toThrow("input byte limit");
  await expect(compare(bytes, bytes, undefined, { limits: { maxPages: 0 } })).rejects.toThrow("page limit");
});

test("honors cancellation before parsing malformed input", async () => {
  const controller = new AbortController(); const reason = new Error("cancel before parse");
  registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
  await expect(compare(new TextEncoder().encode("not a PDF"), pdf("valid"), undefined, {}, controller.signal)).rejects.toBe(reason);
});

test("both aliases work through Shell and registration preflights collisions", async () => {
  const source: string = "../../safe-bash/src/shell/shell.js";
  const { Shell } = await import(source);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.pdf", pdf("Old")); await fs.writeFile("/b.pdf", pdf("New"));
  const shell = new Shell({ fs, cwd: "/" }).use(diffpdfCommands());
  try {
    for (const name of ["diffpdf", "pdfdiff"]) {
      expect(await shell.exec(`${name} a.pdf b.pdf`)).toMatchObject({ exitCode: 1, stdout: "Page 1 differs (text)\n" });
    }
  } finally { await shell.dispose(); }
  const collision = new Shell({ fs, cwd: "/" });
  collision.commands.register({ ...createDiffpdfCommand(), name: "pdfdiff" });
  try {
    expect(() => diffpdfCommands().setup(collision)).toThrow("already registered: pdfdiff");
    expect(collision.commands.has("diffpdf")).toBe(false);
    await diffpdfCommands({ replace: true }).setup(collision);
    expect(collision.commands.has("diffpdf")).toBe(true);
  } finally { await collision.dispose(); }
});
test("detects text and layout differences independently", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.pdf", pdf("Contract"));
  await fs.writeFile("/b.pdf", pdf("Contract", 20));
  const run = async (args: string[]) => {
    let stdout = "";
    const result = await createDiffpdfCommand().execute({ command: "diffpdf", args: createCommandArguments(args).args,
      cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
    return { ...result, stdout };
  };
  expect((await run(["--text", "a.pdf", "b.pdf"])).exitCode).toBe(0);
  expect(await run(["--layout", "a.pdf", "b.pdf"])).toMatchObject({ exitCode: 1, stdout: "Page 1 differs (layout)\n" });
  await fs.writeFile("/b.pdf", pdf("Changed"));
  expect((await run(["a.pdf", "b.pdf"])).exitCode).toBe(1);
});
