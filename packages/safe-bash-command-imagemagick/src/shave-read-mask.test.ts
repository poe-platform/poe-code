import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference outputs for these PPM/PGM bytes.
const input = Buffer.concat([Buffer.from("P6\n7 5\n255\n"), Buffer.from(Array.from({ length: 105 }, (_, i) => (25 * i + 9) % 256))]);
const mask = Buffer.concat([Buffer.from("P5\n7 5\n255\n"), Buffer.from(Array.from({ length: 35 }, (_, i) => [9, 17, 22].includes(i) ? 255 : 0))]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: ["-read-mask", "/mask.pgm", "-shave", "1x1"], expected: "0.39085" },
        { operations: ["-shave", "1x1", "-read-mask", "/mask.pgm"], expected: "0.188235" },
        { operations: ["-read-mask", "/mask.pgm", "-shave", "1x1", "+read-mask"], expected: "0.484183" },
        { operations: ["-shave", "1x1"], expected: "0.484183" },
    ])(`keeps read-mask statistics aligned with shaved pixels: $operations (${mode})`, async ({ operations, expected }) => {
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", ...operations, "-format", "%[fx:mean.r]", "info:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
