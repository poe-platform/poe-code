import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick output, checked with od; independent of the PAM codec.
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000010806000000f4227f8a000000114944415408d7631032096b587df6bd03000dba03c49aeb799b0000000049454e44ae426082", "hex");
const samples = Buffer.from("12345680abcdef40", "hex");
const pam = Buffer.concat([Buffer.from("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), samples]);

for (const sync of [false, true]) {
    for (const destination of ["out.pam", "pam:out.bin"]) it(`writes PAM bytes and alpha to ${destination}, sync=${sync}`, async () => {
        const files = new Map<string, Uint8Array>([["in.png", png]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", png);
        const args = ["in.png", destination];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const path = destination === "out.pam" ? "out.pam" : "out.bin";
        const output = sync ? files.get(path)! : await filesystem.readFile("/" + path);
        expect(Buffer.from(output)).toEqual(pam);
        expect(Buffer.from(decodeImage(output).data)).toEqual(samples);
    });

    it(`reads native P7 with alpha into PNG, sync=${sync}`, async () => {
        const files = new Map<string, Uint8Array>([["in.pam", pam]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", pam);
        const args = ["in.pam", "out.png"];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = sync ? files.get("out.png")! : await filesystem.readFile("/out.png");
        expect(Buffer.from(decodeImage(output).data)).toEqual(samples);
    });
}
