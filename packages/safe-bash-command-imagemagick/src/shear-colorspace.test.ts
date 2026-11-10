import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference input and output.
const source = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("3060b080a04020e0802050b0c01030607733bb90808020c0", "hex"),
]);

const cases = [
    { space: "HSL", shear: true, expected: "f9aae6ff" },
    { space: "Lab", shear: true, expected: "ff6747ff" },
    { space: "sRGB", shear: true, expected: "bdcce6ff" },
    { space: "HSL", shear: false, expected: "3060b080" },
    { space: "Lab", shear: false, expected: "3060b080" },
];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`${mode}: shears working $space channels: $shear`, async ({ space, shear, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.pam", source], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", source);
        await fs.writeFile("/out", keep);
        const args = ["/in.pam", "-colorspace", space, ...(shear ? ["-shear", "20x0"] : []), "-colorspace", "sRGB", "-crop", "1x1+0+0", "+repage", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
