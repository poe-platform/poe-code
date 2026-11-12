import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const input = Buffer.concat([
  Buffer.from("P6\n24 16\n255\n"),
  Buffer.from(Array.from({ length: 24 * 16 * 3 }, (_, i) => {
    const x = Math.floor(i / 3) % 24, y = Math.floor(i / 72);
    return [x * 23, y * 29, (x + y) * 37][i % 3]! % 256;
  }))
]);

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { options: ["-sampling-factor", "4:4:4"], sampling: 0x11 },
    { options: ["-sampling-factor", "4:2:2"], sampling: 0x21 },
    { options: ["-sampling-factor", "2x2"], sampling: 0x22 },
    { options: ["-quality", "85"], sampling: 0x22 },
    { options: ["-quality", "95"], sampling: 0x11 },
    { options: ["-quality", "85", "-sampling-factor", "4:4:4"], sampling: 0x11 },
    { options: ["-quality", "95", "-sampling-factor", "2x2"], sampling: 0x22 },
    { options: ["-quality", "85", "-sampling-factor", "4:4:4", "+sampling-factor"], sampling: 0x22 }
  ])(`${mode} writes JPEG montage sampling with $options`, async ({ options, sampling }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const files = new Map([["/in.ppm", input]]);
    const args = ["/in.ppm", "-tile", "1x", "-geometry", "+0+0", ...options, "jpeg:-"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const result = mode === "magick" || mode === "montage" ? await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    let offset = 2;
    while (offset < output.length && output[offset + 1] !== 0xc0 && output[offset + 1] !== 0xc2)
      offset += 2 + output[offset + 2]! * 256 + output[offset + 3]!;
    expect(output[offset + 1]).toBe(0xc0);
    expect(output[offset + 9]).toBe(3);
    expect([output[offset + 11], output[offset + 14], output[offset + 17]]).toEqual([sampling, 0x11, 0x11]);
    const decoded = decodeImage(output);
    expect([decoded.width, decoded.height]).toEqual([24, 16]);
  });
}
