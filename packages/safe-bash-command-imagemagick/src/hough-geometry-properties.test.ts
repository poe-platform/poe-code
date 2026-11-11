import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new Uint8Array([
    ...new TextEncoder().encode("P6\n9 7\n255\n"),
    ...Array.from({ length: 9 * 7 * 3 }, (_, i) => Math.floor(i / 27) === 3 ? 255 : 0),
]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-set", "option:window", "3x3+6"], geometry: "%[option:window]" },
        { options: [], geometry: "%[fx:3]x3+6" },
        { options: ["-set", "window", "3x3+6"], geometry: "%[window]" },
        { options: ["-resize", "18x14!"], geometry: "%[fx:w/6]x%[fx:h-11]+6" },
        { options: ["-define", "hough-lines:accumulator=true"], geometry: "%[fx:w/3]x3+6" },
    ])(`${mode}: expands Hough geometry $geometry ($options)`, async ({ options, geometry }) => {
        const outputs: Uint8Array[] = [];
        for (const spec of ["3x3+6", geometry]) {
            const fs = new MemoryFileSystem(), files = new Map([["/line.ppm", input]]);
            await fs.writeFile("/line.ppm", input);
            const args = ["/line.ppm", ...options, "-background", "black", "-stroke", "white",
                "-hough-lines", spec, "-depth", "8", "rgb:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            outputs.push(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
        }
        expect(outputs[0]!.length).toBeGreaterThan(0);
        expect(outputs[1]).toEqual(outputs[0]);
    });
}
