import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const input = Buffer.concat([
  Buffer.from("P6\n2 2\n65535\n"),
  Buffer.from("123456789abcdef013572468101121223132414251526162", "hex")
]);

// Exact native ImageMagick 7.1.2-35 Q16-HDRI output for 16-bit RGB input.
for (const mode of ["magick", "montage", "retained", "buffered", "sync", "convert"] as const) {
  it.each([
    { depth: "8", coder: "cmyk", hex: "e171006500e9d621ac5300ce542a009e" },
    { depth: "8", coder: "cmyka", hex: "e1710065ff00e9d621ffac5300ceff542a009eff" },
    { depth: "16", coder: "cmyk", hex: "e1e1f170000043650000cae931d60f2164ac95530000cdce7354392a00009d9e" },
    { depth: "8", coder: "rgb", hex: "12569ade1324102131415161" }
  ])(`${mode}: preserves native $depth-bit $coder samples`, async ({ depth, coder, hex }) => {
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
