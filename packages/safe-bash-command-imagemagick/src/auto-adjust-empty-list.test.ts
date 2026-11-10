import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    ...Buffer.from("4080c0207020906020607040", "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA controls.
const operations = [
    ["-auto-gamma", "64a0d23e923ead833e839264"],
    ["-auto-level", "3399ff008000b36600668033"],
];
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const placement of ["before input", "after delete", "empty group", "after input"] as const) {
        it.each(operations)(`${mode}: %s ${placement} preserves output or produces native pixels`, async (option, pixels) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.pam", input], ["/out", original]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(name, bytes);
            const argv = placement === "after input" ? ["/in.pam", option, "-depth", "8", "rgba:/out"]
                : placement === "empty group" ? ["/in.pam", "(", option, "/in.pam", ")", "-depth", "8", "rgba:/out"]
                : [...(placement === "after delete" ? ["/in.pam", "+delete"] : []), option, "/in.pam", "-depth", "8", "rgba:/out"];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            expect.soft(result.stdout).toBe("");
            if (placement === "after input") {
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stderr).toBe("");
                expect(Buffer.from(output).toString("hex")).toBe(pixels);
            } else {
                expect.soft(result.exitCode).toBe(1);
                expect.soft(result.stderr).toContain(`no images found for operation '${option}'`);
                expect.soft(output).toEqual(original);
            }
        });
    }
}
