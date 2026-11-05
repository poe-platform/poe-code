import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: -delay 10 -size 3x3 xc:red -delay 20 xc:blue -loop 0 gif:-
const input = Buffer.from("R0lGODlhAwADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAwADAAACA4R/BQAh+QQAFAAAACwAAAAAAwADAIAAAP8AAAACA4R/BQA7", "base64");

for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each([false, true])(`sets existing frame delays without changing later inputs (${mode}, later=%s)`, async later => {
    const files = new Map<string, Uint8Array>([["in.gif", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const args = ["in.gif", "-set", "delay", "15", ...(later ? ["in.gif"] : []), "out.gif"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({
      pages: later ? 4 : 2, delay: later ? [150, 150, 100, 200] : [150, 150], loop: 0,
    });
    const pixels = await sharp(output, { animated: true }).raw().toBuffer();
    const original = await sharp(input, { animated: true }).raw().toBuffer();
    expect([...pixels]).toEqual(later ? [...original, ...original] : [...original]);
  });
}
