import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick PNG24/PNG32 fixtures and PAM samples, independent of our codecs.
for (const depth of [8, 16]) for (const alpha of [false, true]) for (const mode of ["sync", "buffered", "retained"]) {
    it(`writes native CMYK PAM samples, alpha=${alpha}, mode=${mode}, depth=${depth}`, async () => {
        const png = Buffer.from(alpha
            ? "89504e470d0a1a0a0000000d4948445200000002000000010806000000f4227f8a000000114944415408d7631032096b587df63d03000d7a0384f58e44b90000000049454e44ae426082"
            : "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f4944415408d7631032095b7df63d0007590304a9020fcd0000000049454e44ae426082", "hex");
        const files = new Map([["in.png", png]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", png);
        const args = ["in.png", "-colorspace", "CMYK", "-depth", String(depth), "out.pam"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.pam") : files.get("out.pam")!;
        expect(Buffer.from(output)).toEqual(Buffer.concat([
            Buffer.from(`P7\nWIDTH 2\nHEIGHT 1\nDEPTH ${alpha ? 5 : 4}\nMAXVAL ${2 ** depth - 1}\nTUPLTYPE CMYK${alpha ? "_ALPHA" : ""}\nENDHDR\n`),
            Buffer.from(depth === 8 ? (alpha ? "ca6500a9804924001000" : "ca6500a949240010") : (alpha ? "ca6a65350000a9a9808048d6246b000010100000" : "ca6a65350000a9a948d6246b00001010"), "hex")
        ]));
    });
}
