import { expect, it } from "vitest";
import { decodeGifImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const source = Buffer.from("R0lGODlhCQALAIEAABEhMf8AAADIAAAA3CH+C3NvdXJjZSBub3RlACH5BAEAAAAALAAAAAAJAAsAAAgmAAEEEDBAIEEABwcWHGhw4cGEEBtKhOhQokKEDitevEjRoMWDAQEAOw==", "base64");

for (const retained of [false, true]) for (const write of [false, true]) {
  it(`sets the GIF transparent palette color without changing opaque pixels, retained=${retained}, write=${write}`, async () => {
    const files = new Map([["/alpha.gif", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/alpha.gif", source);
    const result = await runConvertCli(["/alpha.gif", "-transparent-color", "#e43a72", ...(write ? ["-write", "/out.gif", "null:"] : ["/out.gif"])], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const bytes = retained ? await fs.readFile("/out.gif") : files.get("/out.gif")!;
    expect(Array.from(bytes.subarray(13 + 255 * 3, 13 + 256 * 3))).toEqual([228, 58, 114]);
    const expected = decodeGifImage(source).data;
    let transparent = 0;
    for (let at = 0; at < expected.length; at += 4) {
      if (expected[at + 3] !== 0) continue;
      expected.set([228, 58, 114], at);
      transparent++;
    }
    expect(transparent).toBe(28);
    expect(decodeGifImage(bytes).data).toEqual(expected);
  });
}

for (const retained of [false, true]) {
  it(`snapshots the transparent color at each write, retained=${retained}`, async () => {
    const files = new Map([["/alpha.gif", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/alpha.gif", source);
    const result = await runConvertCli(["/alpha.gif", "-transparent-color", "red", "-write", "/red.gif", "-transparent-color", "blue", "/blue.gif"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    for (const [path, color] of [["/red.gif", [255, 0, 0]], ["/blue.gif", [0, 0, 255]]] as const) {
      const bytes = retained ? await fs.readFile(path) : files.get(path)!;
      expect(Array.from(bytes.subarray(13 + 255 * 3, 13 + 256 * 3))).toEqual(color);
    }
  });

  it(`rejects an invalid transparent color, retained=${retained}`, async () => {
    const files = new Map([["/alpha.gif", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/alpha.gif", source);
    const result = await runConvertCli(["/alpha.gif", "-transparent-color", "invalid-color", "/out.gif"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    if (retained) await expect(fs.readFile("/out.gif")).rejects.toThrow();
    else expect(files.has("/out.gif")).toBe(false);
  });
}
