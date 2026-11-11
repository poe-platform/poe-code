import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { options: ["in.ppm", "-deconstruct"], positions: [2] },
        { options: ["-quiet", "in.ppm", "-deconstruct"], positions: [] },
        { options: ["in.ppm", "-layers", "CompareAny"], positions: [] },
        { options: ["in.ppm", "-deconstruct", "-quiet"], positions: [2] },
        { options: ["-quiet", "in.ppm", "-deconstruct", "+quiet", "-deconstruct"], positions: [5] },
        { options: ["in.ppm", "-deconstruct", "-deconstruct"], positions: [2, 3] },
    ])(`reports deconstruct replacement for $options via ${mode}`, async ({ options, positions }) => {
        // ImageMagick 7.1.2-35 Q16-HDRI: stdout 3x2, exit 0; omit build-specific source locations.
        const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => (i + 1) * 10))]);
        const files = new Map([["in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = [...options, "-format", "%wx%h", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr
        } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "3x2", stderr: positions.map(position =>
            `magick: option has been replaced '-deconstruct', use "-layers CompareAny" at CLI arg ${position}\n`
        ).join("") });
    });
}
