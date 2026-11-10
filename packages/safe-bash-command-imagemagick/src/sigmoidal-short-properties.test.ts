import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");

// Native ImageMagick 7.1.2-35 Q16-HDRI raw RGB references.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["-sigmoidal-contrast", "%w", 1, "0b49940d9cedcbd839"],
        ["+sigmoidal-contrast", "%w", 1, "14568e1694e0bbc849"],
        ["-sigmoidal-contrast", "%[fx:w]", 1, "0b49940d9cedcbd839"],
        ["-sigmoidal-contrast", "3", 1, "0b49940d9cedcbd839"],
        ["-sigmoidal-contrast", "%n", 2, "0d4d920f9aeac7d43d0d4d920f9aeac7d43d"],
        ["-sigmoidal-contrast", "2", 2, "0d4d920f9aeac7d43d0d4d920f9aeac7d43d"]
    ] as const)(`${mode}: expands %s %s with %i inputs`, async (operator, geometry, count, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", sentinel]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = [...Array<string>(count).fill("/a.ppm"), operator, geometry,
            ...(count > 1 ? ["+append"] : []), "-depth", "8", "rgb:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
            argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
