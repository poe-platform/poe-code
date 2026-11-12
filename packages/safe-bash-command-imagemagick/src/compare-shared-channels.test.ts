import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: opaque alpha counts only when both operands have it.
for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const)
for (const [space, first, second, rgbRmse, rgbaRmse, rgbAe, rgbaAe] of [
    ["RGB", "xc:#ff0000", "xc:#0000ff", "53509.1 (0.816497)", "46340.2 (0.707107)", "0.666667 (0.666667)", "0.5 (0.5)"],
    ["CMYK", "xc:cmyk(0%,0%,0%,0%)", "xc:cmyk(0%,0%,0%,100%)", "32767.5 (0.5)", "29308.1 (0.447214)", "0.25 (0.25)", "0.2 (0.2)"]
] as const)
for (const [alphaA, alphaB] of [[false, false], [true, false], [false, true], [true, true]])
for (const metric of ["RMSE", "AE"])
it(`${mode}: ${metric} uses shared ${space} channels (alpha=${alphaA}/${alphaB})`, async () => {
    const argv = ["-metric", metric,
        ...(alphaA ? ["(", first, "-alpha", "set", ")"] : [first]),
        ...(alphaB ? ["(", second, "-alpha", "set", ")"] : [second]), "null:"];
    const filesystem = new MemoryFileSystem();
    let result;
    if (mode === "compare" || mode === "magick") {
        const command = mode === "compare" ? createCompareCommand() : createMagickCommand();
        const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
        let stdout = "", stderr = "";
        result = { ...await command.execute({
            command: command.name, args: argumentValues.args, argumentValues,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr };
    } else result = mode === "sync" ? runCompareCliSync(argv, new Map())
        : await runCompareCli(argv, mode === "buffered" ? new Map() : { filesystem, cwd: "/" });
    const expected = metric === "RMSE" ? (alphaA && alphaB ? rgbaRmse : rgbRmse)
        : (alphaA && alphaB ? rgbaAe : rgbAe);
    expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: 1, stdout: "", stderr: expected });
});
