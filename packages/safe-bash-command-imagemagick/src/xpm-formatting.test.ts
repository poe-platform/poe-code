import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { runMagickCli, runMagickCliSync, createMagickCommand } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(["None", "white"])(`writes native XPM section formatting to stdout (${mode}, %s)`, async color => {
        const input = new TextEncoder().encode(`/* XPM */
static char *icon[] = {
"3 1 3 1",
"a c red",
"b c blue",
". c ${color}",
"ab."
};
`);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/icon.xpm", input);
        const argv = ["icon.xpm", "xpm:-"];
        let stdout = "", stderr = "", exitCode: number;
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            exitCode = result.exitCode;
        } else {
            const files = new Map([["icon.xpm", input]]);
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            exitCode = result.exitCode;
            stdout = new TextDecoder().decode(result.stdoutBytes);
            stderr = result.stderr;
        }
        expect(exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        // ImageMagick 7.1.2-35: preserve comments and the space inside the header.
        const lines = stdout.split("\n");
        expect(lines.slice(0, 4)).toEqual([
            "/* XPM */",
            "static char *_[] = {",
            "/* columns rows colors chars-per-pixel */",
            '"3 1 3 1 ",'
        ]);
        expect(lines.slice(7)).toEqual([
            "/* pixels */",
            color === "None" ? '".X "' : '" .X"',
            "};",
            ""
        ]);
    });
}
