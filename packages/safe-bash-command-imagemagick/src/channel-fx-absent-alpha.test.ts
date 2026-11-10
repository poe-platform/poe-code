import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI. Only the full destination name
// "alpha" activates alpha; a/4/o leave an absent destination untouched.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { input: ["xc:#204080"], expression: "a", expected: undefined },
        { input: ["xc:#204080"], expression: "a=>r", expected: undefined },
        { input: ["xc:#204080"], expression: "a=50%", expected: undefined },
        { input: ["xc:#204080"], expression: "alpha=50%", expected: undefined },
        { input: ["xc:#204080"], expression: "r=>a", expected: "204080ff", channels: "srgb  3.0" },
        { input: ["xc:#204080"], expression: "r<=>a", expected: "204080ff", channels: "srgb  3.0" },
        { input: ["xc:#204080"], expression: "a<=>r", expected: undefined },
        { input: ["xc:#204080"], expression: "r=>4", expected: "204080ff", channels: "srgb  3.0" },
        { input: ["xc:#204080"], expression: "r<=>o", expected: "204080ff", channels: "srgb  3.0" },
        { input: ["xc:#204080"], expression: "r=>alpha", expected: "20408020", channels: "srgba 4.0" },
        { input: ["xc:#204080"], expression: "r<=>alpha", expected: "20408020", channels: "srgba 4.0" },
        { input: ["xc:#204080"], expression: "r=>alpha,a=>r", expected: undefined },
        { input: ["xc:#204080c0"], expression: "r=>a", expected: "20408020", channels: "srgba 4.0" },
        { input: ["xc:#204080c0"], expression: "a=50%", expected: "20408080", channels: "srgba 4.0" },
        { input: ["xc:#204080c0"], expression: "a=>r", expected: "c04080c0", channels: "srgba 4.0" },
        { input: ["xc:#204080", "-alpha", "set"], expression: "r=>a", expected: "20408020", channels: "srgba 4.0" },
        { input: ["xc:#204080c0", "-alpha", "off"], expression: "a", expected: undefined },
        { input: ["xc:#204080c0", "-alpha", "off"], expression: "r<=>a", expected: "204080ff", channels: "srgb  3.0" },
        { input: ["xc:#204080c0", "-alpha", "deactivate"], expression: "a=>r", expected: "c04080ff" },
        { input: ["xc:#204080c0", "-alpha", "deactivate"], expression: "a", expected: "c0c0c0ff" },
        { input: ["xc:#204080c0", "-alpha", "deactivate"], expression: "r=>alpha", expected: "20408020", channels: "srgba 4.0" },
        { input: ["xc:#204080", "xc:#12345678"], expression: "|a=>r", expected: "784080ff", channels: "srgb  3.0" },
        { input: ["xc:#204080c0", "xc:#123456"], expression: "|a=>r", expected: undefined },
        { input: ["xc:#204080c0", "xc:#123456"], expression: "|r<=>a", expected: "20408012", channels: "srgba 4.0" },
    ])(`honors channel availability in ${mode}: $input $expression`, async ({ input, expression, expected, channels }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const original = new Uint8Array([1, 2, 3]);
        files.set("/channels.txt", original);
        await fs.writeFile("/channels.txt", original);
        const argv = [...input, "-channel-fx", expression, "-depth", "8", "-write", "rgba:-", "-format", "%[channels]", "info:/channels.txt"];
        let exitCode: number, stderr = "", stdout: Uint8Array;
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            exitCode = result.exitCode;
            stdout = Buffer.concat(chunks);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout = result.stdoutBytes ?? new Uint8Array();
        }
        expect(exitCode, stderr).toBe(expected === undefined ? 1 : 0);
        expect(Buffer.from(stdout).toString("hex")).toBe(expected ?? "");
        const output = mode === "sync" || mode === "buffered" ? files.get("/channels.txt")! : await fs.readFile("/channels.txt");
        if (expected === undefined) {
            expect(stderr).toContain("missing image channel");
            expect(output).toEqual(original);
        } else {
            expect(stderr).toBe("");
            if (channels) expect(new TextDecoder().decode(output)).toBe(channels);
        }
    });
}
