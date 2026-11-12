import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const red = Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([255, 0, 0])]);
const blue = Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([0, 0, 255])]);

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { input: "-", options: [], bytes: Buffer.concat([red, blue]), hex: "ff00000000ff" },
    { input: "ppm:-", options: [], bytes: Buffer.concat([red, blue]), hex: "ff00000000ff" },
    { input: "-", options: [], bytes: red, hex: "ff0000" },
    { input: "ppm:-", options: ["-reverse"], bytes: Buffer.concat([red, blue]), hex: "0000ffff0000" },
    { input: "-", options: ["-reverse"], bytes: Buffer.concat([red, blue]), hex: "0000ffff0000" },
    { input: "ppm:-", options: ["-reverse", "-reverse"], bytes: Buffer.concat([red, blue]), hex: "ff00000000ff" },
    { input: "ppm:-", options: ["-reverse", "xc:lime"], bytes: Buffer.concat([red, blue]), hex: "0000ffff000000ff00" },
    { input: "ppm:-", options: ["xc:lime", "-reverse"], bytes: Buffer.concat([red, blue]), hex: "00ff000000ffff0000" },
    { input: "ppm:-[1,0]", options: ["-reverse"], bytes: Buffer.concat([red, blue]), hex: "ff00000000ff" },
    { input: "ppm:-", options: ["-reverse"], bytes: red, hex: "ff0000" },
  ])(`${mode}: montage orders PPM frames from $input with $options ($hex)`, async ({ input, options, bytes, hex }) => {
    const args = [input, ...options, "-geometry", "+0+0", "-tile", "x1", "-depth", "8", "rgb:-"];
    const filesystem = new MemoryFileSystem();
    const stdin = (async function* () {
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
