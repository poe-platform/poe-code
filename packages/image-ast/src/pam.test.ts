import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { decodeImage, encodeImage } from "./index.js";

for (const [tuple, channels, maximum, hex, rgba] of [
    ["BLACKANDWHITE", 1, 1, "0001", "000000ffffffffff"],
    ["GRAYSCALE_ALPHA", 2, 255, "0a2320ff", "0a0a0a23202020ff"],
    ["CMYK", 4, 255, "00ffff00ff000080", "ff0000ff007f7fff"],
    ["CMYK_ALPHA", 5, 255, "00ffff0080ff000080ff", "ff000080007f7fff"],
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
        expect(metadata).toMatchObject({ format: "pam", width: 2, height: 1, channels, hasAlpha: tuple.endsWith("_ALPHA") });
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

for (const depth of [8, 16]) for (const alpha of [false, true]) {
    it(`preserves grayscale PAM layout at ${depth} bits, alpha=${alpha}`, async () => {
        const tuple = alpha ? "GRAYSCALE_ALPHA" : "GRAYSCALE";
        const channels = alpha ? 2 : 1;
        const samples = Buffer.from(depth === 16 ? (alpha ? "12348080abcd0000" : "1234abcd") : (alpha ? "2f80c800" : "2fc8"), "hex");
        const input = Buffer.concat([Buffer.from(`P7\nWIDTH 2\nHEIGHT 1\nDEPTH ${channels}\nMAXVAL ${depth === 16 ? 65535 : 255}\nTUPLTYPE ${tuple}\nENDHDR\n`), samples]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", input);
        const sync = encodeImage(decodeImage(input), { format: "pam" });
        expect(Buffer.from(sync.data)).toEqual(input);
        expect(sync.channels).toBe(channels);
        await sharp("/in.pam", { filesystem }).toFormat("pam").toFile("/out.pam");
        expect(Buffer.from(await filesystem.readFile("/out.pam"))).toEqual(input);
    });
}
