import { expect, it } from "vitest";
import sharp from "./index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

it("supports explicit PSB output and infers PSB file destinations", async () => {
    const filesystem = new MemoryFileSystem();
    const input = new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n");
    const explicit = sharp(input).toFormat("psb").toBufferSync();
    expect(Buffer.from(explicit.subarray(0, 8)).toString("hex")).toBe("3842505300020000");
    await filesystem.writeFile("/input.ppm", input);
    const info = await sharp("/input.ppm", { filesystem }).toFile("/out.psb");
    expect(info.format).toBe("psb");
    expect(await filesystem.readFile("/out.psb")).toEqual(explicit);
});
