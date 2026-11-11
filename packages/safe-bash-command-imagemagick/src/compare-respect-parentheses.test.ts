import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Native ImageMagick 7.1.2 reference results: channel selection remains global,
// while -respect-parentheses restores image settings at the closing parenthesis.
for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    for (const option of ["-respect-parentheses", "+respect-parentheses"]) {
        for (const scopedSize of [false, true]) {
            it(`${option} ${scopedSize ? "scopes image size" : "accepts grouped channel selection"} (${mode})`, async () => {
                const files = new Map([
                    ["a.ppm", new TextEncoder().encode("P3\n2 1\n255\n40 80 120 160 200 240\n")],
                    ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n40 80 120 160 199 240\n")]
                ]);
                const filesystem = new MemoryFileSystem();
                for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
                const args = [option, "-metric", "AE", ...(scopedSize
                    ? ["-format", "%w", "-size", "2x1", "(", "-size", "1x1", "xc:red", ")", "xc:red", "-delete", "0", "xc:red"]
                    : ["(", "-channel", "R", "a.ppm", ")", "b.ppm"]), "null:"];
                let result;
                if (mode === "compare" || mode === "magick") {
                    const command = mode === "compare" ? createCompareCommand() : createMagickCommand();
                    const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]);
                    let stdout = "", stderr = "";
                    result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                        cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                        stdin: (async function* () {})(),
                        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                    }), stdout, stderr };
                } else result = mode === "sync" ? runCompareCliSync(args, files)
                    : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                expect(result).toEqual({ exitCode: 0, stdout: scopedSize ? option === "-respect-parentheses" ? "2" : "1" : "", stderr: "0 (0)" });
            });
        }
    }
}

it.each([
    { options: ["-respect-parentheses", "-size", "3x1", "(", "-size", "2x1", "(", "-size", "1x1", "xc:red", ")", ")"], width: "3" },
    { options: ["-respect-parentheses", "-size", "2x1", "(", "-size", "1x1", "xc:red", "+respect-parentheses", ")"], width: "1" },
    { options: ["+respect-parentheses", "-size", "2x1", "(", "-size", "1x1", "xc:red", "-respect-parentheses", ")"], width: "2" }
])("uses the active setting when closing nested or toggled groups: $options", async ({ options, width }) => {
    const args = ["-metric", "AE", "-format", "%w", ...options, "xc:red", "-delete", "0", "xc:red", "null:"];
    for (const input of [new Map<string, Uint8Array>(), { filesystem: new MemoryFileSystem(), cwd: "/" }]) {
        expect(await runCompareCli(args, input)).toEqual({ exitCode: 0, stdout: width, stderr: "0 (0)" });
    }
});
