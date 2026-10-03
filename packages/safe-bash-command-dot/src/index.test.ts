import { expect, test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { PdfDocument, decodePng } from "@poe-code/pdf-ast";
import { createDotCommand, dotCommands, type DotCommandsOptions } from "./index.js";

async function run(source: string, args: string[] = [], options: DotCommandsOptions = {}, signal = new AbortController().signal) {
  const fs = createMemoryFileSystem(); let stdout = ""; let stderr = "";
  const result = await createDotCommand(options).execute({ command: "dot", args: createCommandArguments(args).args,
    cwd: "/", env: {}, fs, signal, stdin: toByteSource(source),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  return { ...result, stdout, stderr };
}

test("admits layout cost before running graph algorithms", async () => {
  expect(await run("digraph { a -> b }", [], { limits: { maxLayoutCost: 0 } })).toMatchObject({ exitCode: 1, stdout: "", stderr: "dot: graph layout cost limit exceeded\n" });
});

test.each([
  'digraph { a -> b [minlen="1000000000"] }',
  `digraph { { ${Array.from({ length: 30 }, (_, i) => `a${i}`).join(";")} } -> { ${Array.from({ length: 30 }, (_, i) => `b${i}`).join(";")} } }`,
])("rejects rank and Cartesian edge amplification", async source => {
  expect(await run(source)).toMatchObject({ exitCode: 1, stdout: "", stderr: "dot: graph layout cost limit exceeded\n" });
});

test.each([["-T"], ["-Tjpeg"], ["-o"], ["--unknown"], ["a", "b"]])("rejects invalid options %j", async (...args) => {
  expect(await run("digraph { a -> b }", args)).toMatchObject({ exitCode: 1, stdout: "" });
});

test("rejects malformed DOT without output", async () => {
  expect(await run("digraph { a -> }")).toMatchObject({ exitCode: 1, stdout: "" });
});

test("enforces input/node limits and cancellation", async () => {
  await expect(run("digraph { a }", [], { limits: { maxInputBytes: 1 } })).rejects.toThrow("input byte limit");
  expect(await run("digraph { a }", [], { limits: { maxNodes: 0 } })).toMatchObject({ exitCode: 1, stdout: "" });
  const controller = new AbortController(); const reason = new Error("stop DOT");
  registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
  await expect(run("digraph { a }", [], {}, controller.signal)).rejects.toBe(reason);
});

test("pipes DOT through SVG conversion from a virtual shell script", async () => {
  const shellSource: string = "../../safe-bash/src/shell/shell.js";
  const { Shell } = await import(shellSource);
  const converterSource: string = "../../safe-bash-command-rsvg-convert/src/index.js";
  const { rsvgConvertCommands } = await import(converterSource);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/graph.dot", new TextEncoder().encode("digraph { a -> b }"));
  await fs.writeFile("/render.sh", new TextEncoder().encode("dot -Tsvg graph.dot | rsvg-convert -f pdf -o graph.pdf\n"));
  const shell = new Shell({ fs, cwd: "/" }).use(dotCommands()).use(rsvgConvertCommands());
  try {
    const result = await shell.exec("sh /render.sh");
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    expect(PdfDocument.load(await fs.readFile("/graph.pdf")).pageCount).toBe(1);
  } finally { await shell.dispose(); }
});

test.each(["svg", "pdf", "png"])("renders DOT to %s in the VFS", async format => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/graph.dot", new TextEncoder().encode('digraph { a [label="Build"]; a -> b; }'));
  const result = await createDotCommand().execute({ command: "dot", args: createCommandArguments([`-T${format}`, "graph.dot", "-o", `out.${format}`]).args,
    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0);
  const bytes = await fs.readFile(`/out.${format}`);
  if (format === "svg") expect(new TextDecoder().decode(bytes)).toContain("Build");
  if (format === "pdf") expect(PdfDocument.load(bytes).pageCount).toBe(1);
  if (format === "png") expect(decodePng(bytes).width).toBeGreaterThan(0);
});
