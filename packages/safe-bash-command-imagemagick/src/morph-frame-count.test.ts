import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "map", "filesystem", "command"] as const) {
    it.each([
        { inputs: ["/a.ppm", "/b.ppm"], count: "%n", scenes: "0;1;2;3;" },
        { inputs: ["/a.ppm", "/b.ppm"], count: "%[fx:n]", scenes: "0;1;2;3;" },
        { inputs: ["/a.ppm", "/b.ppm"], count: "%[fx:n-1]", scenes: "0;1;2;" },
        { inputs: ["/a.ppm", "/b.ppm"], count: "2", scenes: "0;1;2;3;" },
        { inputs: ["/a.ppm", "/b.ppm", "/c.ppm"], count: "%n", scenes: "0;1;2;3;4;5;6;7;8;" },
        { inputs: ["/a.ppm", "/b.ppm", "/c.ppm"], count: "3", scenes: "0;1;2;3;4;5;6;7;8;" }
    ])(`uses the current morph frame count (${mode}): $inputs $count`, async ({ inputs, count, scenes }) => {
        // Scene sequences from ImageMagick 7.1.2-35 Q16-HDRI.
        const files = new Map([
            ["/a.ppm", "P3\n2 1\n255\n13 30 79 235 153 61\n"],
            ["/b.ppm", "P3\n2 1\n255\n52 73 91 114 137 180\n"],
            ["/c.ppm", "P3\n1 2\n255\n52 73 91 114 137 180\n"],
            ["/out", "KEEP"]
        ].map(([path, contents]) => [path!, new TextEncoder().encode(contents)]));
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = [...inputs, "-morph", count, "-format", "%s;", "info:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect(new TextDecoder().decode(mode === "filesystem" || mode === "command" ? await fs.readFile("/out") : files.get("/out"))).toBe(scenes);
    });
}
