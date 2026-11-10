import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI; both PNGs retain the same two palette entries.
const fixtures = [
    {
        name: "used palette entries",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAABlBMVEUgQGDIoIwUq6epAAAACklEQVR4nGNwAAAAQgBBKTf07wAAAABJRU5ErkJggg==",
        cases: [
            { options: [], expected: "204060ffc8a08cff" },
            { options: ["-cycle", "1"], expected: "c8a08cff204060ff" },
            { options: ["-auto-level"], expected: "003161ffffc2a4ff" },
            { options: ["-auto-level", "-cycle", "1"], expected: "ffc2a4ff003161ff" },
        ],
    },
    {
        name: "unused palette entry",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAABlBMVEUgQGDIoIwUq6epAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
        cases: [
            { options: [], expected: "204060ff" },
            { options: ["-cycle", "1"], expected: "c8a08cff" },
            { options: ["-auto-level"], expected: "0080ffff" },
            { options: ["-auto-level", "-cycle", "1"], expected: "ffffffff" },
        ],
    },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const fixture of fixtures) {
        it.each(fixture.cases)(`${mode}: ${fixture.name} $options`, async ({ options, expected }) => {
            const input = Buffer.from(fixture.png, "base64");
            const files = new Map<string, Uint8Array>([["/in.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", ...options, "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
            expect(Buffer.from(actual).toString("hex")).toBe(expected);
        });
    }
}
