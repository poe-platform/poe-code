import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: a 4x3 gradient on a 10x8 page at +3+2,
// and an 8x6 gradient. Filename area geometry first checks the source width.
const fixtures = [
    {
        input: Buffer.from("R0lGODlhCgAIAPEAAP8AAAAA/4AAgAAAACH5BAAAAAAALAMAAgAEAAMAAAIFhCEpwVEAOw==", "base64"),
        cases: [
            ["4@", false, 4, 3, 10, 8, 3, 2],
            ["4@>", false, 4, 3, 10, 8, 3, 2],
            ["1@", false, 1, 1, 3, 3, 1, 0],
            ["12@", false, 4, 3, 10, 8, 3, 2],
            ["4x4@", false, 2, 2, 5, 5, 1, 1],
            ["4x9@", false, 2, 2, 5, 5, 1, 1],
            ["", false, 4, 3, 10, 8, 3, 2],
            ["4@", true, 2, 2, 5, 5, 1, 1]
        ]
    },
    {
        input: Buffer.from("R0lGODlhCAAGAPIAAP8AAMwAM5kAZmYAmTMAzAAA/wAAAAAAACH5BAAAAAAALAAAAAAIAAYAAAMQCLoa/k7IKYe9luiti/9eAgA7", "base64"),
        cases: [
            ["8@", false, 8, 6, 8, 6, 0, 0],
            ["4@", false, 2, 2, 2, 2, 0, 0],
            ["", false, 8, 6, 8, 6, 0, 0],
            ["8@", true, 3, 2, 3, 2, 0, 0]
        ]
    }
] as const;

for (const mode of ["buffered", "retained", "command", "sync"] as const)
for (const { input, cases } of fixtures)
for (const [geometry, resize, width, height, pageWidth, pageHeight, x, y] of cases) {
    it(`${mode}: ${input.length}-byte GIF ${resize ? "-resize" : "filename"} ${geometry || "unmodified"} preserves native dimensions and placement`, async () => {
        const files = new Map([["/input.gif", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.gif", input);
        const args = resize ? ["/input.gif", "-resize", geometry, "/output.gif"]
            : [geometry ? `/input.gif[${geometry}]` : "/input.gif", "/output.gif"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/output.gif") : files.get("/output.gif")!, { coalesce: false });
        expect(output).toMatchObject({ width, height, virtualCanvas: { width: pageWidth, height: pageHeight, x, y } });
        const original = decodeImage(input, { coalesce: false });
        if (width === original.width && height === original.height) expect(output.data).toEqual(original.data);
    });
}
