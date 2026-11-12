import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35: -map applies -remap and warns without failing,
// including with -regard-warnings; -quiet suppresses the warning.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operator: "-map", prefix: [], warning: true },
        { operator: "-map", prefix: ["-quiet"], warning: false },
        { operator: "-map", prefix: ["-regard-warnings"], warning: true },
        { operator: "-map", prefix: ["-quiet", "-regard-warnings"], warning: false },
        { operator: "-remap", prefix: [], warning: false },
    ])(`applies $operator with $prefix via ${mode}`, async ({ operator, prefix, warning }) => {
        const args = [...prefix, "xc:#909090", "+dither", operator, "xc:#123456", "-depth", "8", "rgb:-"];
        const filesystem = new MemoryFileSystem();
        let stderr = "";
        const bytes: number[] = [];
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { bytes.push(...chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }), stderr, stdoutBytes: new Uint8Array(bytes)
        } : mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
        expect(result).toMatchObject({ exitCode: 0, stderr: warning
            ? `magick: option has been replaced '-map', use "-remap" at CLI arg ${prefix.length + 3}\n` : "" });
        expect(Array.from(result.stdoutBytes ?? [])).toEqual([0x12, 0x34, 0x56]);
    });
}

for (const retained of [false, true]) {
    it(`consumes a palette file argument in mogrify, retained=${retained}`, async () => {
        const files = new Map([
            ["/input.ppm", new TextEncoder().encode("P3\n1 1\n255\n144 144 144\n")],
            ["/palette.ppm", new TextEncoder().encode("P3\n1 1\n255\n18 52 86\n")],
        ]);
        const filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const result = await runMogrifyCli(["+dither", "-map", "/palette.ppm", "/input.ppm"],
            retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toContain("option has been replaced '-map', use \"-remap\"");
        const output = retained ? await filesystem.readFile("/input.ppm") : files.get("/input.ppm")!;
        expect(Array.from(decodeImage(output).data)).toEqual([18, 52, 86, 255]);
    });
}
