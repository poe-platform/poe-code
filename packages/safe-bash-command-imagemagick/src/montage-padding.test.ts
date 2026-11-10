import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { expect, it } from "vitest";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const geometry of [["+0+0"], ["1x1"], ["1x1+1+1", "1x1"], ["1x1+0+0"]]) {
  it(`${mode}: resets montage padding with ${geometry.join(" then ")}`, async () => {
    const args = [...geometry.flatMap(value => ["-geometry", value]), "-tile", "1x1", "xc:red", "-depth", "8", "png:-"];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "command") {
      const argumentValues = createCommandArguments(["montage", ...args]);
      const stdout: Uint8Array[] = [], stderr: unknown[] = [];
      const context: CommandContext = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      expect((await createMagickCommand().execute(context)).exitCode, String(stderr)).toBe(0);
      expect(stderr).toEqual([]);
      output = Buffer.concat(stdout);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([1, 1]);
    expect([...image.data]).toEqual([255, 0, 0, 255]);
  });
}
