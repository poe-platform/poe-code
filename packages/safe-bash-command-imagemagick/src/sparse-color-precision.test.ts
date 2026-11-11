import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const target of ["-", "out.dat"]) {
        it.each([
            { precision: ["-precision", "3"], color: "67.1%,7.11%,33.8%" },
            { precision: ["-precision", "9"], color: "67.1107042%,7.1107042%,33.7773709%" },
            { precision: [], color: "67.1107%,7.1107%,33.7774%" }
        ])(`honors sparse-color precision (${mode}, ${target}): $precision`, async ({ precision, color }) => {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = [...precision, "-size", "2x1", "xc:#abcd12345678", "-depth", "16", `sparse-color:${target}`];
            const expected = `0,0,srgb(${color}) 1,0,srgb(${color}) `;
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stdout: target === "-" ? expected : "", stderr: "" });
            if (target !== "-") expect(new TextDecoder().decode(mode === "buffered" || mode === "sync" ? files.get(target) : await fs.readFile(`/${target}`))).toBe(expected);
        });
    }
}
