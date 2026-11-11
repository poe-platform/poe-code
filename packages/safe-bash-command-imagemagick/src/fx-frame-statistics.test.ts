import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    async function convert(argv: string[]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
        return { stdout: "stdout" in result ? result.stdout : stdout,
            output: mode === "command" || mode === "retained" ? await fs.readFile("/out.rgb").catch(() => undefined) : files.get("/out.rgb") };
    }
    // ImageMagick 7.1.2-35 Q16-HDRI reference output.
    it.each([
        ["mean", "0.25098;0.752941;"], ["u.mean", "0.25098;0.25098;"],
        ["v.mean", "0.752941;0.752941;"], ["u[1].mean", "0.752941;0.752941;"],
        ["u[1].maxima", "0.752941;0.752941;"], ["u[1].w", "1;1;"],
        ["u[-1].mean.r", "0.752941;0.752941;"], ["s.mean", "0.25098;0.752941;"],
    ])(`${mode}: selects the frame for %s`, async (expression, expected) => {
        expect((await convert(["xc:#404040", "xc:#c0c0c0", "-format", `%[fx:${expression}];`, "info:"])).stdout).toBe(expected);
    });
    it.each([["u.mean", "404040"], ["v.mean", "c0c0c0"], ["u[1].mean", "c0c0c0"]])(
        `${mode}: selects statistics in -fx %s`, async (expression, expected) => {
            const result = await convert(["xc:#404040", "xc:#c0c0c0", "-fx", expression, "-depth", "8", "rgb:/out.rgb"]);
            expect(Buffer.from(result.output!).toString("hex")).toBe(expected);
        });
    it.each([
        ["u.mean", "4060805f4f3f406080a04f3f"],
        ["u[1].mean", "40607f5f4f3f4060805f4f3f"],
        ["mean", "4060805f4f3f4060805f4f3f"],
    ])(`${mode}: uses %s for solarize thresholds`, async (expression, expected) => {
        const result = await convert(["xc:#406080", "xc:#a0b0c0", "+append", "(", "+clone", "-negate", ")",
            "-solarize", `%[fx:100*${expression}]%`, "-depth", "8", "rgb:/out.rgb"]);
        expect(Buffer.from(result.output!).toString("hex")).toBe(expected);
    });
}
