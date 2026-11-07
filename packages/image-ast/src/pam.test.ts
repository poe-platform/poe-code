import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { decodeImage } from "./index.js";

for (const [tuple, channels, maximum, hex, rgba] of [
    ["BLACKANDWHITE", 1, 1, "0001", "000000ffffffffff"],
    ["GRAYSCALE_ALPHA", 2, 255, "0a2320ff", "0a0a0a23202020ff"],
    ["RGB", 3, 255, "123456abcdef", "123456ffabcdefff"],
    ["RGB_ALPHA", 4, 65535, "1234343456568080ababcdcdefef4040", "12345680abcdef40"]
] as const) {
    it(`decodes ${tuple} PAM samples and retained metadata`, async () => {
        const input = Buffer.concat([Buffer.from(`P7\n# native tuple layout\nHEIGHT 1\nWIDTH 2\nMAXVAL ${maximum}\nDEPTH ${channels}\nTUPLTYPE ${tuple}\nENDHDR\n`), Buffer.from(hex, "hex")]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", input);
        const expected = Buffer.from(rgba, "hex");
        expect(Buffer.from(decodeImage(input).data)).toEqual(expected);
        const metadata = await sharp("/in", { filesystem }).metadata();
        expect(metadata).toMatchObject({ format: "pam", width: 2, height: 1, channels, hasAlpha: channels === 2 || channels === 4 });
        await sharp("/in", { filesystem }).toFormat("pam").toFile("/out");
        const sync = Buffer.from(sharp(input).toFormat("pam").toBufferSync());
        expect(Buffer.from(await filesystem.readFile("/out"))).toEqual(sync);
        expect(Buffer.from(decodeImage(sync).data)).toEqual(expected);
        if (maximum === 65535) {
            const header = Buffer.from("ENDHDR\n");
            expect(sync.subarray(sync.indexOf(header) + header.length)).toEqual(Buffer.from(hex, "hex"));
        }
    });
}

for (const header of [
    "WIDTH 0\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nENDHDR\n",
    "WIDTH 1\nHEIGHT 1\nDEPTH 5\nMAXVAL 255\nENDHDR\n",
    "WIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 65536\nENDHDR\n",
    "WIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n",
    "WIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\n",
    "WIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nENDHDR\n"
]) it("rejects invalid or truncated PAM in both decoders", async () => {
    const input = Buffer.from("P7\n" + header);
    expect(() => decodeImage(input)).toThrow();
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in", input);
    await expect(sharp("/in", { filesystem }).png().toFile("/out")).rejects.toThrow();
});
