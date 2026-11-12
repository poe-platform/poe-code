import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const input = Buffer.concat([
  Buffer.from("P6\n2 2\n65535\n"),
  Buffer.from("123456789abcdef013572468101121223132414251526162", "hex")
]);

// Exact native ImageMagick 7.1.2-35 Q16-HDRI output from the same 16-bit RGB input.
for (const mode of ["magick", "montage", "retained", "buffered", "sync", "convert"] as const) {
  it.each([
    { depth: "8", coder: "gray", hex: "4c3f1f4f" },
    { depth: "8", coder: "graya", hex: "4cff3fff1fff4fff" },
    { depth: "16", coder: "gray", hex: "e14cde3faa1e104f" },
    { depth: "8", coder: "rgb", hex: "12569ade1324102131415161" }
  ])(`${mode}: applies RGB depth before exporting $depth-bit $coder`, async ({ depth, coder, hex }) => {
    const args = ["/in.ppm", ...(mode === "convert" ? [] : ["-tile", "1x", "-geometry", "+0+0"]), "-depth", depth, `${coder}:-`];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage" || mode === "convert") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await (mode === "montage" ? createMontageCommand() : createMagickCommand()).execute({
        command: mode === "montage" ? "montage" : "magick", args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
      });
      expect(result.exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = Buffer.concat(stdout);
    } else {
      const files = new Map([["/in.ppm", input]]);
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}
