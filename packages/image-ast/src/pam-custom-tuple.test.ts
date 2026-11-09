import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { decodeImage } from "./index.js";

for (const [tuple, depth, samples, expected] of [
    ["FANCY", 3, "4180c0", "4180c0ff"],
    ["FOO", 4, "4180c000", "4180c0ff"],
    ["FOO", 4, "4180c00011223344", "4180c0ff001122ff"],
    ["constructor", 3, "4180c0", "4180c0ff"],
    ["RGB", 3, "4180c0", "4180c0ff"],
    ["RGB_ALPHA", 4, "4180c000", "4180c000"]
] as const) it(`decodes PAM ${tuple} depth ${depth} raster ${samples}`, async () => {
    const width = expected.length / 8;
    const input = Buffer.concat([Buffer.from(`P7\nWIDTH ${width}\nHEIGHT 1\nDEPTH ${depth}\nMAXVAL 255\nTUPLTYPE ${tuple}\nENDHDR\n`), Buffer.from(samples, "hex")]);
    expect(Buffer.from(decodeImage(input).data).toString("hex")).toBe(expected);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pam", input);
    expect(await sharp("/in.pam", { filesystem }).metadata()).toMatchObject({ channels: tuple === "RGB_ALPHA" ? 4 : 3, hasAlpha: tuple === "RGB_ALPHA" });
    await sharp("/in.pam", { filesystem }).png().toFile("/out.png");
    expect(Buffer.from(decodeImage(await filesystem.readFile("/out.png")).data).toString("hex")).toBe(expected);
});
