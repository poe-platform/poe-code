import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI; the second PNG has an unused palette entry.
const fixtures = [
    {
        name: "ordered palette",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABAgMAAABmjvwnAAAADFBMVEUgICAoWozSoG4AAACiSI3YAAAACklEQVR4nGOQAAAAGgAZLYj0NgAAAABJRU5ErkJggg==",
        cases: [
            { options: [], expected: "202020ff285a8cffd2a06eff" },
            { options: ["-cycle", "1"], expected: "285a8cffd2a06eff000000ff" },
            { options: ["-solarize", "50%"], expected: "202020ff285a73ff2d5f6eff" },
            { options: ["-solarize", "50%", "-cycle", "1"], expected: "285a73ff2d5f6eff000000ff" },
        ],
    },
    {
        name: "unused palette entry",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAABlBMVEUAAADIoIxw0g3VAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
        cases: [
            { options: [], expected: "000000ff" },
            { options: ["-cycle", "1"], expected: "c8a08cff" },
            { options: ["-solarize", "50%"], expected: "000000ff" },
            { options: ["-solarize", "50%", "-cycle", "1"], expected: "375f73ff" },
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
