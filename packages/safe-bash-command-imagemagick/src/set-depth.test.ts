import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Expected outputs from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["xc:red", "3.9", ["-format", "%z|%[depth]", "info:/out"], "3|3"],
        ["xc:#73889a", "8bits", ["-format", "%z|%[depth];", "info:/out"], "8|8;"],
        ["xc:red", "0x10", ["-format", "%z|%[depth]", "info:/out"], "0|0"],
        ["xc:red", "abc", ["-format", "%z|%[depth]", "info:/out"], "0|0"],
        ["xc:#73889a", "8", ["-format", "%z|%[depth];", "info:/out"], "8|8;"],
        ["xc:#73889a", "4", ["-format", "%z|%[depth];", "info:/out"], "4|4;"],
        ["xc:#73889a", "4", ["-depth", "8", "rgb:/out"], Buffer.from("73889a", "hex")],
    ] as const)(`reads depth metadata as a leading decimal integer (${mode}): %s %s`, async (input, depth, output, expected) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = [input, "-set", "depth", depth, ...output];
        const argumentValues = createCommandArguments(args);
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes)).toEqual(Buffer.from(expected));
    });
}
