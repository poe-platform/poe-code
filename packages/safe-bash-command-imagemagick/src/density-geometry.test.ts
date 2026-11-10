import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const beforeInput of [false, true])
it.each([
  { density: "100:50", x: 2, y: 1 },
  { density: "(100x50)", x: 100, y: 50 },
  { density: "100x50", x: 100, y: 50 },
])(`${mode}: $density (before input=${beforeInput})`, async ({ density, x, y }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const settings = ["-units", "PixelsPerCentimeter", "-density", density];
  const args = [...(beforeInput ? [...settings, "xc:red"] : ["xc:red", ...settings]),
    "-write", "PNG24:/output.png", "-format", "%x/%y/%U", "info:-"];
  let stdout = "", stderr = "";
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  }) : mode === "sync" ? runMagickCliSync(args, files)
    : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  expect("stdout" in result ? result.stdout : stdout).toBe(`${x}/${y}/PixelsPerCentimeter`);
  const output = mode === "buffered" || mode === "sync" ? files.get("/output.png")! : await fs.readFile("/output.png");
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let physical: number[] | undefined;
  for (let offset = 8; offset + 12 <= output.length; offset += view.getUint32(offset) + 12) {
    if (view.getUint32(offset + 4) === 0x70485973) {
      physical = [view.getUint32(offset + 8), view.getUint32(offset + 12), output[offset + 16]!];
    }
  }
  expect(physical).toEqual([x * 100, y * 100, 1]);
});
