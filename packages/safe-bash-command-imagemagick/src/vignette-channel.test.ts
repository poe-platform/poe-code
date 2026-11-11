import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    // Native ImageMagick 7.1.2-35 Q16-HDRI, RGBA samples (16-bit little endian).
    it.each([
        [8, "white", [
            "3654a27c3648aed87b44299d9b656b8ced8d523c08e6c910dd69cd5a148a9930",
            "744d42c660b1e2479d8a231028291528b6d77e9604e2796ae52c487a4ef10bbf",
            "8db0652357a4b383c845df147289fd48662f91036f1982e6d5ee5b2855515197",
            "f232749538acee34b68bf8ec06180cf9447128cec8c05889182f7126f9b5d484",
            "10f50bc4ac6adab64e8254b51e28fc06828c9c13fb7b2b5924e41ecc639bf718",
            "10fe6f01f6ef61f5c8b9d9b92250d3b531bb5cfe1ad6419dfb5b7cf7de2e2687",
            "10fe6f01f6ef61f5c8b9d9b92250d3b531bb5cfe1ad6419dfb5b7cf7de2e2687",
        ]],
        [16, "white", [
            "67937bb601ea5638e3984370aa641383fafcec563113631c1b3ef9ef6c42cafc",
            "2d13664d8f30e50b9fa088366cf66c8d310d9c4199cb3aaa94bcb52e2cf52349",
            "cb6c6fe6bccf0119ae216224745a26963fdc0155597a92a73075582c8fc24d70",
            "2b6e99ee899e1515e0cc44b220424cd9da6906b39490504bdcca2236755db51c",
            "04838fd3737db150a050fd72c8df0c71fc0870e6b32da7aadd4b95a70983198b",
            "ae788cce3bb41f90ac05340a892c9721d03815ad14163b541f3d5fc74acfe042",
            "ae788cce3bb41f90ac05340a892c9721d03815ad14163b541f3d5fc74acfe042",
        ]],
        [8, "#12345640", [
            "56d4926496fbcfc127ecedc90d56b14b25b35f24fb9c85080ef728bb4cf8a0fc",
            "d1223f91c3b2fa07861bda5fd512651e39aa8a3c68d3dbf783bab19518ad6ed2",
            "88b8477fae94eba1b4275bb8dfe6b958408ccefb4b88ca8ff5efc57e4b1c98ee",
            "0e4b8ed552a7638271e237897edc4b780aab7f0d8ae366ac63a05f7c60d6c183",
            "0c2cea679c5c5204f69cb47d45cd0e2c4742c4db18225d7b1f828ebd49410911",
            "01d279a013a78a8aa27c1c3d7ef7a31b27e3b720a0adbd67924a0968dcda9f25",
            "af52b0ab886ef000cff80eef22a0a3e5538a62a984d6656125bd70dbad1f3e6f",
        ]],
        [16, "#12345640", [
            "7daf8ebedbb53166be2641daa69c30bc5179b3843d218657df736cf6b2942aeb",
            "c112fa8666680f2d10d3221803736cc0bbec34344db2fc4bd19457075a5da5d1",
            "87accd5ffc5cb78209a056bf670e8e365dcc68b3200b652cac4ebfeca667b828",
            "d5642fbd05b316528ffc43307cde14ea526acd2129c54eca7e4ecf26a2c90168",
            "ecc3057a5437d212ea7770e5c84605974e9a4ef9f64f45172379d09e02f57ffc",
            "1de89463964b233fe3ebb1d3f013def58a973468c39c4c2612abb9be6eddafa8",
            "dd4c8f98ebc2a2234012d3599d11b964b8fa91cf6892c4ef62ab4668cc828139",
        ]],
    ] as const)(`respects vignette channels and resets them (${mode}, %i bit, %s)`, async (depth, background, hashes) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
            : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const read = async (path: string) => decodeImage(mode === "retained" ? await filesystem.readFile(path) : files.get(path)!);
        const data = Uint8Array.from({ length: 20 * 16 * 4 }, (_, i) => [48, 96, 160, 128][i % 4]!);
        const input = encodeImage({ width: 20, height: 16, data, format: "png", space: "srgb", channels: 4,
            depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true,
            ...(depth === 16 ? { data16: Uint16Array.from(data, value => value * 257 + 1) } : {}) }, { format: "png" }).data;
        files.set("/input.png", input);
        await filesystem.writeFile("/input.png", input);
        expect((await run(["/input.png", "-background", background, "-vignette", "0x1+3+2", "/plain.png"])).exitCode).toBe(0);
        const plain = await read("/plain.png");
        for (const [index, mask] of ["R", "G", "B", "A", "RG", "RGB", "RGBA"].entries()) {
            const result = await run(["/input.png", "-background", background, "-channel", mask, "-vignette", "0x1+3+2", "/masked.png"]);
            expect(result.exitCode, result.stderr).toBe(0);
            const masked = await read("/masked.png");
            const actual = depth === 16 ? masked.data16! : masked.data;
            expect(actual).toBeDefined();
            const bytes = new Uint8Array(actual.length * (depth === 16 ? 2 : 1));
            const view = new DataView(bytes.buffer);
            for (let i = 0; i < actual.length; i++) {
                if (depth === 16) view.setUint16(i * 2, actual[i]!, true);
                else bytes[i] = actual[i]!;
            }
            expect(createHash("sha256").update(bytes).digest("hex"), mask).toBe(hashes[index]);
        }
        expect((await run(["/input.png", "-background", background, "-channel", "R", "+channel", "-vignette", "0x1+3+2", "/reset.png"])).exitCode).toBe(0);
        expect((await read("/reset.png")).data).toEqual(plain.data);
    });
}
