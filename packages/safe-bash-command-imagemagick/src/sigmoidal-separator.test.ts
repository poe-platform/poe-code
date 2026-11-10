import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const separator of ["X", "x"]) {
        it.each([
            ["-sigmoidal-contrast", "0b54b10cbaf7e3eb3f"],
            ["+sigmoidal-contrast", "144d79177ec9a0ac42"]
        ])(`${mode}: matches native %s 5${separator}40%% pixels`, async (option, expected) => {
            // Native ImageMagick 7.1.2-35 Q16-HDRI, with either separator.
            const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
            const sentinel = new TextEncoder().encode("KEEP");
            const files = new Map([["/a.ppm", input], ["/out", sentinel]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/a.ppm", input);
            await fs.writeFile("/out", sentinel);
            const argv = ["/a.ppm", option, `5${separator}40%`, "-depth", "8", "rgb:/out"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
