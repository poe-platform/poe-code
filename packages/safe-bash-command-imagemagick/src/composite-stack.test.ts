import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const route of ["sync", "buffered", "retained"] as const) {
  for (const existingOutput of [false, true]) {
    it(`${route}: rejects a one-image composite without publishing output (existing=${existingOutput})`, async () => {
      const input = sharp(new Uint8Array([12, 34, 56, 255, 78, 90, 123, 128, 144, 160, 180, 64, 210, 220, 230, 255]),
        { raw: { width: 2, height: 2, channels: 4 } }).png().toBufferSync();
      const original = new Uint8Array([1, 2, 3]);
      const files = new Map([["/in.png", input]]);
      if (existingOutput) files.set("/out.png", original);
      const filesystem = new MemoryFileSystem();
      for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
      const args = ["/in.png", "-composite", "/out.png"];
      const result = route === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, route === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("image sequence is required");
      if (route === "retained") {
        if (existingOutput) expect(await filesystem.readFile("/out.png")).toEqual(original);
        else await expect(filesystem.readFile("/out.png")).rejects.toThrow();
      } else expect(files.get("/out.png")).toEqual(existingOutput ? original : undefined);
    });
  }

  it(`${route}: still composites two images`, async () => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = ["-size", "1x1", "xc:blue", "xc:red", "-composite", "/out.png"];
    const result = route === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = route === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect([...decodeImage(output).data]).toEqual([255, 0, 0, 255]);
  });
}
