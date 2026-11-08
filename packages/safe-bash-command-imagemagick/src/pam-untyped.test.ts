import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const sync of [false, true]) for (const depth of [1, 2, 3, 4, 5]) {
    it(`matches native untyped PAM depth ${depth}, sync=${sync}`, async () => {
        const input = Buffer.concat([
            Buffer.from(`P7\nWIDTH 2\nHEIGHT 1\nDEPTH ${depth}\nMAXVAL 255\nENDHDR\n`),
            Buffer.from("12345680abcdef001234", "hex").subarray(0, depth * 2)
        ]);
        const files = new Map<string, Uint8Array>([["in.pam", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", input);
        const args = ["in.pam", "-depth", "8", "out.rgba"];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        if (depth < 3) {
            expect(result.exitCode).not.toBe(0);
        } else {
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = sync ? files.get("out.rgba")! : await filesystem.readFile("/out.rgba");
            expect(Buffer.from(output)).toEqual(Buffer.from("123456ff80abcdff", "hex"));
        }
    });
}
