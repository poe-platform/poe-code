import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: absent alpha is opaque for bare a,
// but qualified u.a samples red. Deactivated alpha remains addressable.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const { input, alpha, qualified } of [
        { input: ["xc:#123456"], alpha: "1", qualified: "0.0705882" },
        { input: ["xc:#123456", "-alpha", "off"], alpha: "1", qualified: "0.0705882" },
        { input: ["xc:#12345678", "-alpha", "off"], alpha: "1", qualified: "0.0705882" },
        { input: ["xc:#12345678"], alpha: "0.470588", qualified: "0.470588" },
        { input: ["xc:#12345678", "-alpha", "deactivate"], alpha: "0.470588", qualified: "0.470588" }
    ]) {
        it.each([
            { operation: ["-format", "%[fx:a]|%[fx:u.a]|%[fx:r]", "info:/out"], expected: `${alpha}|${qualified}|0.0705882`, text: true },
            { operation: ["-fx", "a", "-depth", "8", "rgb:/out"], expected: alpha === "1" ? "ffffff" : "787878", text: false },
            { operation: ["-fx", "u.a", "-depth", "8", "rgb:/out"], expected: qualified === "0.0705882" ? "121212" : "787878", text: false }
        ])(`${mode}: ${input.join(" ")} $operation`, async ({ operation, expected, text }) => {
            const args = [...input, ...operation];
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "sync" || mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
            expect(text ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
