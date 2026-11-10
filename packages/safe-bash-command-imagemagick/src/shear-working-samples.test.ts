import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI restores these bytes for every round trip below.
const pixels = Buffer.from("3060b080a04020e0802050b0c01030607733bb90808020c0", "hex");
const input = Buffer.concat([Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), pixels]);

for (const mode of ["command", "sync"] as const) {
    it.each([
        ["-evaluate", "Multiply", "3", "-shear", "0x0", "-evaluate", "Divide", "3"],
        ["-evaluate", "Divide", "7", "-shear", "0x0", "-evaluate", "Multiply", "7"],
        ["-shear", "0x0"],
        ["-evaluate", "Multiply", "3", "-evaluate", "Divide", "3"],
        ["-evaluate", "Divide", "7", "-evaluate", "Multiply", "7"]
    ].map(operations => ({ operations })))(`preserves working samples: $operations (${mode})`, async ({ operations }) => {
        const args = ["/in.pam", ...operations, "-depth", "8", "rgba:/out"];
        const keep = new TextEncoder().encode("KEEP");
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", keep]]);
            const result = runConvertCliSync(args, files);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(Buffer.from(files.get("/out")!)).toEqual(pixels);
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.pam", input);
            await fs.writeFile("/out", keep);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(Buffer.from(await fs.readFile("/out"))).toEqual(pixels);
        }
    });
}
