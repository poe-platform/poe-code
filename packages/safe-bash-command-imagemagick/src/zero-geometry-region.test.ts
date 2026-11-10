import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves these translucent PAM pixels.
const pixels = "3060b080a04020e0802050b0c01030607733bb90808020c0";
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["-region", "2x1+1+0", "-shear", "0x0", "+region"],
        ["-shear", "0x0"],
        ["-region", "2x1+1+0", "+region"],
        ["-region", "2x1+1+0", "-splice", "0x0+0+0", "+region"],
        ["-splice", "0x0+0+0"],
    ].map(operations => ({ operations })))(`${mode}: preserves pixels for $operations`, async ({ operations }) => {
        const files = new Map<string, Uint8Array>([
            ["/in.pam", Buffer.concat([Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from(pixels, "hex")])],
            ["/out", Buffer.from("KEEP")],
        ]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/in.pam", ...operations, "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixels);
    });
}
