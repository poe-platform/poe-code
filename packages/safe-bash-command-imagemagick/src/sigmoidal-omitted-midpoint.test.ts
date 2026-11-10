import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: a.ppm +sigmoidal-contrast GEOMETRY -depth 8 rgb:out.
const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["5x%", "ffffffffffffffffff"],
        ["5,%", "ffffffffffffffffff"],
        ["5/%", "ffffffffffffffffff"],
        ["5%", "ffffffffffffffffff"],
        ["5x0%", "06214107459364711a"]
    ])(`${mode}: matches native inverse sigmoidal contrast with %s`, async (geometry, expected) => {
        const files = new Map([["a.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(`/${path}`, data);
        const argv = ["a.ppm", "+sigmoidal-contrast", geometry, "-depth", "8", "rgb:out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
