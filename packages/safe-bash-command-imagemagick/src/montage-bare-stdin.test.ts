import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const red = Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([255, 0, 0])]);
const blue = Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([0, 0, 255])]);

for (const chunked of [false, true])
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { input: "-", bytes: Buffer.concat([red, blue]), hex: "ff00000000ff" },
    { input: "ppm:-", bytes: Buffer.concat([red, blue]), hex: "ff00000000ff" },
    { input: "-", bytes: red, hex: "ff0000" },
  ])(`${mode}: montage reads every PPM frame from $input ($hex), chunked=${chunked}`, async ({ input, bytes, hex }) => {
    const args = [input, "-geometry", "+0+0", "-tile", "x1", "-depth", "8", "rgb:-"];
    const filesystem = new MemoryFileSystem();
    const stdin = (async function* () {
      if (!chunked) { yield bytes; return; }
      // Split both a header and a pixel across stream chunks.
      yield bytes.subarray(0, 4);
      yield bytes.subarray(4, red.length - 1);
      yield bytes.subarray(red.length - 1);
    })();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin,
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
        stderr: { async write(chunk) { errors.push(chunk.slice()); } },
      });
      expect(Buffer.concat(errors).toString()).toBe("");
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map(), bytes)
        : mode === "buffered" ? await runMontageCli(args, new Map(), bytes)
        : await runMontageCli(args, { filesystem, cwd: "/", stdin });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}
