import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick WBMP bytes and gray-output checksums, independent of our encoders.
const fixtures = [
  { width: 11, input: Buffer.from("00000b0c5ac0a7000fa05ac0a7000fa05ac0a7000fa05ac0a7000fa0", "hex"), hash: "55c314319c292a137abb00a59aeb1dfcc3a3367ac66213f2cc3635eec46ed76b" },
  { width: 259, input: Buffer.concat([Buffer.from("000082030c", "hex"), Buffer.from(Array.from({ length: 33 * 12 }, (_, i) => i % 33 < 32 ? 255 - ((i % 33 * 13 + Math.floor(i / 33) * 29 + 5) % 256) : 0x40))]), hash: "3073be48303ddd682a2750abd7b5f000034daa8fdab8b2cb20c7b1cc5c2e81b8" }
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each(fixtures)(`reads native $width-pixel WBMP rows (${mode})`, async ({ width, input, hash }) => {
    const files = new Map<string, Uint8Array>([["/target.wbmp", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/target.wbmp", input);
    const args = ["/target.wbmp", "-depth", "8", "gray:/out.raw"];
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    } else {
      expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
    expect(output.length).toBe(width * 12);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it(`leaves existing output intact for truncated WBMP (${mode})`, async () => {
    const input = fixtures[0]!.input.subarray(0, -1), original = new TextEncoder().encode("keep output");
    const files = new Map<string, Uint8Array>([["/bad.wbmp", input], ["/out.raw", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/bad.wbmp", input);
    await filesystem.writeFile("/out.raw", original);
    const args = ["/bad.wbmp", "-depth", "8", "gray:/out.raw"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Truncated WBMP pixels");
    expect(mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")).toEqual(original);
  });
}

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { width: 8, height: 1, hex: "0000080100", exitCode: 1 },
    { width: 16, height: 2, hex: "0000100200000000", exitCode: 1 },
    { width: 8, height: 4, hex: "0000080400000000", exitCode: 0 },
    { width: 16, height: 8, hex: "0000100800000000000000000000000000000000", exitCode: 0 },
    { width: 8, height: 3, hex: "00000803000000", exitCode: 1 },
    { width: 1, height: 1, hex: "0000010100", exitCode: 0 },
    // Native checks total file size, including trailing bytes, rather than raster size.
    { width: 8, height: 1, hex: "0000080100000000", exitCode: 0 }
  ])(`matches native WBMP file-size admission for $width x $height, $hex (${mode})`, async ({ width, height, hex, exitCode }) => {
    const input = Buffer.from(hex, "hex");
    const files = new Map<string, Uint8Array>([["/target.wbmp", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/target.wbmp", input);
    const args = ["/target.wbmp", "-depth", "8", "gray:-"];
    let actualExitCode: number, stderr: string, stdout: Uint8Array;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
      stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      actualExitCode = result.exitCode;
      stdout = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      actualExitCode = result.exitCode;
      stderr = result.stderr;
      stdout = result.stdoutBytes ?? new TextEncoder().encode(result.stdout);
    }
    expect(actualExitCode).toBe(exitCode);
    expect(Array.from(stdout)).toEqual(Array(exitCode ? 0 : width * height).fill(0));
    if (exitCode) expect(stderr).toContain("insufficient image data in file");
    else expect(stderr).toBe("");
  });
}
