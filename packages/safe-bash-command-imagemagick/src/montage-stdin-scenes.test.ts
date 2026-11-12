import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Two concatenated 1x1 PPM frames: red, blue.
const pair = Buffer.concat([
  Buffer.from("P6\n1 1\n255\n"), Buffer.from([255, 0, 0]),
  Buffer.from("P6\n1 1\n255\n"), Buffer.from([0, 0, 255])
]);

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { input: "-", hex: "ff00000000ff" },
    { input: "-[1]", hex: "0000ff" },
    { input: "-[1,0]", hex: "0000ffff0000" },
    { input: "-[1-0]", hex: "0000ffff0000" },
    { input: "-[0,1,0]", hex: "ff00000000ffff0000" },
    { input: "ppm:-[1,0]", hex: "0000ffff0000" }
  ])(`${mode}: montage selects stdin frames in requested order from $input`, async ({ input, hex }) => {
    const args = [input, "-geometry", "+0+0", "-tile", "x1", "-depth", "8", "rgb:-"];
    const filesystem = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () { yield pair; })(),
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
        stderr: { async write(chunk) { errors.push(chunk.slice()); } }
      });
      expect(Buffer.concat(errors).toString()).toBe("");
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map(), pair)
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem, cwd: "/" }, pair);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}
