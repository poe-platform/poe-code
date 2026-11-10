import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["public", "buffered", "retained", "sync"] as const) {
  // Native ImageMagick 7.1.2-35 Q16-HDRI, complete raw RGBA8 output.
  it.each([
    { name: "single pixel", input: ["-limit", "thread", "1", "xc:#20406080"], expected: "20406080" },
    { name: "morph", input: ["-limit", "thread", "1", "-size", "2x1", "xc:#20406080", "-size", "4x1", "xc:#a0c0e040", "-morph", "1", "-delete", "0,2", "+channel"], expected: "6080a0606080a0606080a060" },
    { name: "higher cap after input", input: ["xc:#20406080", "-limit", "thread", "8"], expected: "20406080" },
    { name: "repeated limits in parentheses", input: ["-limit", "thread", "8", "(", "-limit", "thread", "1", "xc:#20406080", ")"], expected: "20406080" },
    { name: "convert subcommand", input: ["convert", "-limit", "thread", "1", "xc:#20406080"], expected: "20406080" },
    { name: "without limit", input: ["xc:#20406080"], expected: "20406080" }
  ])(`$name (${mode})`, async ({ input, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [...input, "-depth", "8", "rgba:-"], argumentValues = createCommandArguments(argv);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "public" ? { ...await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
  });

  it.each([
    ["-limit"], ["-limit", "thread"], ["-limit", "thread", ""],
    ["-limit", "thread", "0"], ["-limit", "thread", "-1"],
    ["-limit", "thread", "1.5"], ["-limit", "thread", "invalid"],
    ["-limit", "thread", "Infinity"], ["-limit", "memory", "1"]
  ])(`rejects invalid or unsupported limits without replacing output (${mode}): %j`, async (...limit) => {
    const fs = new MemoryFileSystem(), original = new TextEncoder().encode("KEEP");
    const files = new Map([["/out.png", original]]);
    await fs.writeFile("/out.png", original);
    const argv = ["xc:#20406080", ...limit, "/out.png"], argumentValues = createCommandArguments(argv);
    const result = mode === "public" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).not.toBe(0);
    expect(mode === "buffered" || mode === "sync" ? files.get("/out.png") : await fs.readFile("/out.png")).toEqual(original);
  });
}

it("does not relax host input limits when a higher thread cap is requested", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in", new Uint8Array(4));
  const argumentValues = createCommandArguments(["-limit", "thread", "8", "/in", "/out.png"]);
  await expect(createMagickCommand({ limits: { maxInputBytes: 3 } }).execute({
    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write() {} }
  })).rejects.toThrow("input byte limit");
});
