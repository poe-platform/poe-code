import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference input and output.
const source = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("3060b080a04020e0802050b0c01030607733bb90808020c0", "hex"),
]);

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["before input", "after delete", "after input"] as const)(`${mode}: shear %s`, async position => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.pam", source], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", source);
        await fs.writeFile("/out", keep);
        const args = position === "before input" ? ["-shear", "20x0", "/in.pam"]
            : position === "after delete" ? ["/in.pam", "-delete", "0", "-shear", "20x0", "/in.pam"]
                : ["/in.pam", "-shear", "20x0"];
        args.push("-depth", "8", "rgba:/out");
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const valid = position === "after input";
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        if (!valid) expect.soft("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-shear'");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(valid
            ? "bdcce6ffa47774ffa9606bffdfc7d3ffe7a5b1ffb28cd9ff9f9f57ffffffffff"
            : "4b454550");
    });
}
