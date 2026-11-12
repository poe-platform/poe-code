import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompareCliSync, runConvertCliSync } from "./index.js";
import fixtures from "./compare-tiff-cmyk-fixtures.json" with { type: "json" };

// Independently generated with native ImageMagick from literal CMYK colors.
for (const mode of ["sync", "public"] as const) {
    it.each([
        { args: ["compare", "-metric", "RMSE", "swatch.tif", "xc:cmyk(20%,40%,60%,80%)", "null:"], stdout: "", stderr: "0 (0)" },
        { args: ["swatch.tif", "-format", "%[colorspace] %[pixel:p{0,0}]", "info:"], stdout: "CMYK cmyk(51,102,153,204)", stderr: "" },
        { args: ["compare", "-metric", "RMSE", "-subimage-search", "-channel", "K", "ink.tif", "swatch.tif", "null:"], stdout: "", stderr: "0 (0) @ 1,0 [0]" },
        { args: ["compare", "-metric", "RMSE", "-subimage-search", "ink.tif", "swatch.tif", "null:"], stdout: "", stderr: "0 (0) @ 1,0 [0]" },
        { args: ["compare", "-metric", "RMSE", "swatch.miff", "xc:cmyk(20%,40%,60%,80%)", "null:"], stdout: "", stderr: "0 (0)" }
    ])(`${mode}: preserves TIFF inks for $args`, async ({ args, stdout: expectedOut, stderr: expectedErr }) => {
        const files = new Map(Object.entries(fixtures).map(([name, base64]) => [name, Buffer.from(base64, "base64")]));
        let result;
        if (mode === "sync") result = args[0] === "compare" ? runCompareCliSync(args.slice(1), files) : runConvertCliSync(args, files);
        else {
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr };
        }
        expect({ ...result, stdout: result.stdout.trim(), stderr: result.stderr.trim() }).toEqual({ exitCode: 0, stdout: expectedOut, stderr: expectedErr });
    });
}
