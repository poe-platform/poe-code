import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  // ImageMagick 7.1.2-35: durations in milliseconds; default loop/disposal and pixels stay unchanged.
  for (const destination of ["gif:-", "/sheet.gif"])
  it.each([
    { options: [], duration: 0 },
    { options: ["-delay", "7"], duration: 70 },
    { options: ["-delay", "15x50"], duration: 300 },
    { options: ["-delay", "7", "+delay"], duration: 0 }
  ])(`sets GIF page timing via ${mode} to ${destination}: $options`, async ({ options, duration }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = ["xc:red", "xc:blue", "-tile", "1x1", "-geometry", "+0+0", ...options, destination];
    let bytes: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
        command: mode, args: mode === "magick" ? ["montage", ...args] : args,
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      bytes = destination === "gif:-" ? Buffer.concat(chunks) : await fs.readFile(destination);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      bytes = destination === "gif:-" ? result.stdoutBytes!
        : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
    }
    const image = decodeImage(bytes, { animated: true });
    expect(image.delay).toEqual([duration, duration]);
    expect(image.loop).toBe(0);
    for (const page of [0, 1]) expect(decodeImage(bytes, { page, coalesce: false }).disposal).toBe(0);
    expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });
}

for (const mode of ["retained", "buffered", "sync"] as const) {
  it.each([{ values: [] }, { values: ["bogus"] }, { values: ["12xbogus"] }])(`rejects invalid delay without overwriting output via ${mode}: $values`, async ({ values }) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/sheet.gif", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/sheet.gif", keep);
    const args = ["xc:red", "/sheet.gif", "-delay", ...values];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(values.length ? "invalid argument for option '-delay'" : "missing argument for -delay");
    expect(result.stdoutBytes).toBeUndefined();
    expect(mode === "retained" ? await fs.readFile("/sheet.gif") : files.get("/sheet.gif")).toEqual(keep);
  });
}
