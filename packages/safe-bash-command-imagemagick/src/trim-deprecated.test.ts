import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: +trim exits 1; -trim produces 4x3 7x5+1+1.
const pixels = new Uint8Array(7 * 5 * 3).fill(255);
for (let y = 2; y <= 3; y++) for (let x = 3; x <= 4; x++) pixels.set([160, 30, 90], (y * 7 + x) * 3);
pixels.set([249, 249, 249], (1 * 7 + 1) * 3);
const input = Buffer.concat([Buffer.from("P6\n7 5\n255\n"), pixels]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const destination of ["info:", "info:/out"]) {
        it.each([
            { option: "+trim", grouped: false },
            { option: "+trim", grouped: true },
            { option: "-trim", grouped: false }
        ])(`${mode}: matches native $option status and geometry (grouped=$grouped, ${destination})`, async ({ option, grouped }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.ppm", input], ["/out", original]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            await fs.writeFile("/out", original);
            const argv = [...(grouped ? ["("] : []), "/in.ppm", option, ...(grouped ? [")"] : []),
                "-format", "%wx%h %g", destination];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect.soft(result.exitCode).toBe(option === "+trim" ? 1 : 0);
            expect.soft("stderr" in result ? result.stderr : stderr).toBe(option === "+trim"
                ? `magick: option deprecated, unable to execute '+trim' at CLI arg ${grouped ? 3 : 2}\n` : "");
            expect("stdout" in result ? result.stdout : stdout)
                .toBe(option === "-trim" && destination === "info:" ? "4x3 7x5+1+1" : "");
            expect(mode === "buffered" || mode === "sync" ? files.get("/out") : await fs.readFile("/out"))
                .toEqual(option === "-trim" && destination === "info:/out" ? new TextEncoder().encode("4x3 7x5+1+1") : original);
        });
    }
}
