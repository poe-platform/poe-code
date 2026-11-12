import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: preserve KEEP on failure, otherwise compare RGBA bytes.
for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([
        ["120+75", 1, "4b454550"],
        ["120+75+133", 1, "4b454550"],
        ["120-75", 1, "4b454550"],
        ["120+7e1", 1, "4b454550"],
        ["120%+75+133", 0, "257bd680"],
        ["120%+75%+133%", 0, "257bd680"],
        ["120%+75", 0, "257bd680"],
        ["120+75%", 0, "257bd680"],
        ["120!+75+133", 0, "257bd680"],
        ["120.5+75", 0, "257bd680"],
        ["120+7.5", 0, "257bd680"],
        ["1.2e+2+75", 0, "257bd680"],
        ["120x75+133", 0, "975fce80"],
        ["120%x75+133", 0, "975fce80"],
        ["+120+75+133", 0, "3925d680"],
        ["100", 0, "257bd680"],
        ["120%", 0, "4d95e080"],
    ] as const)(`${mode}: modulation %s exits %i and preserves native output`, async (value, exitCode, hex) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/dest", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/dest", original);
        const argv = ["xc:#257bd680", "-modulate", value, "-depth", "8", "rgba:/dest"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(exitCode);
        if (exitCode !== 0) expect("stderr" in result ? result.stderr : stderr).toContain("-modulate");
        expect(mode === "command" ? await fs.readFile("/dest") : files.get("/dest")).toEqual(new Uint8Array(Buffer.from(hex, "hex")));
    });
}
