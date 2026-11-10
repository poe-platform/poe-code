import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runMagickCli, runMagickCliSync } from "./index.js";

it.each([["+", 0], ["-", -0]] as const)("parses an empty first %s offset without losing dimensions", (sign, x) => {
    expect(parseMagickGeometry(`1x2${sign}`)).toMatchObject({
        width: 1, height: 2, x, y: 0, hasOffset: true, hasYOffset: false,
    });
});

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps the rectangle for a sign-only first offset.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const geometry of ["1x2+", "1x2-", "1x2", "1x2+0"]) {
        it.each([
            ["-splice", "4x4", false],
            ["-chop", "3x2", true],
            ["-shave", "3x2", true],
        ] as const)(`preserves dimensions for %s ${geometry} (${mode})`, async (operation, expected, warns) => {
            const sentinel = new TextEncoder().encode("KEEP");
            const files = new Map([["out", sentinel]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", sentinel);
            const args = ["-size", "3x2", "xc:red", operation, geometry, "-format", "%wx%h", "info:out"];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
            expect(new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
