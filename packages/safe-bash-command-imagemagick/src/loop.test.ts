import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) for (const write of [false, true]) {
  it.each(["3", "%[option:count]", "%[fx:n+1]", "%[fx:u.w+2]"])(`expands loop %s (retained=${retained}, write=${write})`, async operand => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    expect(await runConvertCli([
      "xc:red", "xc:blue", "-set", "option:count", "3", "-loop", operand,
      ...(write ? ["-write", "out.gif", "-loop", "0", "null:"] : ["out.gif"])
    ], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
    const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
    expect(extension).toBeGreaterThan(-1);
    expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, 2, 0, 0]);
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [0, 0] });
  });
}

for (const retained of [false, true]) {
  it.each([0, 1, 2])(`writes GIF loop %i (retained=${retained})`, async loop => {
    const pixels = new Uint8Array(3 * 3 * 2 * 4);
    for (let i = 0; i < 18; i++) pixels.set(i < 9 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    const input = await sharp(pixels, { raw: { width: 3, height: 6, channels: 4 } })
      .gif({ pageHeight: 3, delay: [100, 200], loop: 0 }).toBuffer();
    const files = new Map([["in.gif", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    expect(await runConvertCli(["in.gif", "-loop", String(loop), "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
    const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
    if (loop === 1) expect(extension).toBe(-1);
    else {
      expect(extension).toBeGreaterThan(-1);
      expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, loop === 0 ? 0 : 1, 0, 0]);
    }
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [100, 200] });
  });
}

for (const retained of [false, true]) {
  it.each([0, 1, 4])(`preserves GIF loop %i on rewrite (retained=${retained})`, async loop => {
    const pixels = Uint8Array.of(255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255);
    const input = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
      .gif({ pageHeight: 1, delay: [70, 130], loop }).toBuffer();
    const files = new Map([["in.gif", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    expect(await runConvertCli(["in.gif", "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
    const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
    if (loop === 1) expect(extension).toBe(-1);
    else {
      expect(extension).toBeGreaterThan(-1);
      expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, loop === 0 ? 0 : 3, 0, 0]);
    }
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [70, 130], loop });
    expect(await sharp(output, { animated: true }).raw().toBuffer()).toEqual(pixels);
  });
}
