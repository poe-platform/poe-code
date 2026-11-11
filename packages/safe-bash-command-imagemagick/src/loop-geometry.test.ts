import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: repeat counts, not total plays; null means play once.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["3x2", 2], ["3/2", 2], ["12%", 11], ["1e1", null], ["0x3", 0], ["3", 2], ["3.75", 2],
    ["garbage", undefined], ["3bad", undefined],
  ] as const)(`parses -loop %s before publishing a GIF (${mode})`, async (value, repeats) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["saved.gif", keep]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/saved.gif", keep);
    const args = ["xc:red", "xc:blue", "-set", "option:count", "3", "-loop", value, "saved.gif"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
      signal: new AbortController().signal, fs: filesystem,
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/saved.gif") : files.get("saved.gif")!;
    expect(result.exitCode).toBe(repeats === undefined ? 1 : 0);
    if (repeats === undefined) {
      expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-loop'");
      expect(output).toEqual(keep);
    } else {
      const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
      if (repeats === null) expect(extension).toBe(-1);
      else {
        expect(extension).toBeGreaterThan(-1);
        expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, repeats, 0, 0]);
      }
      expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [0, 0] });
    }
  });

  it.each(["garbage", "3bad"])(`rejects -loop %s without emitting GIF bytes (${mode})`, async value => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = ["xc:red", "xc:blue", "-loop", value, "gif:-"];
    const argumentValues = createCommandArguments(args);
    let bytesWritten = 0;
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
      signal: new AbortController().signal, fs: filesystem,
      stdin: (async function* () {})(), stderr: { async write() {} },
      stdout: { async write(bytes: Uint8Array) { bytesWritten += bytes.length; } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect("stdout" in result && typeof result.stdout === "string" ? result.stdout.length : bytesWritten).toBe(0);
    if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) expect(result.stdoutBytes.length).toBe(0);
  });
}

// Native accepts slash geometry before the inputs without changing frame timing.
it.each(["3/2", "3x2", "3"])("streams GIF loop geometry %s through the public command", async value => {
  const argumentValues = createCommandArguments(["-loop", value, "xc:red", "xc:blue", "gif:-"]);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
    signal: new AbortController().signal, fs: new MemoryFileSystem(),
    stdin: (async function* () {})(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  const output = Buffer.concat(chunks);
  const extension = output.indexOf("NETSCAPE2.0");
  expect(extension).toBeGreaterThan(-1);
  expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, 2, 0, 0]);
  expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [0, 0] });
});
