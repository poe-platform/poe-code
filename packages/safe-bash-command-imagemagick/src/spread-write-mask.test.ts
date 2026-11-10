import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (37 * i + 11) % 256))]);
const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from([0, 255, 0, 255, 255, 0, 0, 0, 0, 0, 255, 255])]);
const spread = ["-seed", "17", "-spread", "2"];
const cases = [
    { name: "exported alpha with displaced mask", options: spread, expected: "878e58007a9fc4ffd0f51aff587da2ffc7ec1100b7dc37ffcd335800587da2ff8bb027ffb03a5f006186ab00d0f51aff" },
    { name: "negate through displaced mask", options: [...spread, "-negate", "+write-mask"], expected: "7d7b8bff7f858bffd0f51aff587da2ff3813eeffb3d53cff59a593ff587da2ff849160ff758e86ff857e78ffd0f51aff" },
    { name: "pixels after mask removal", options: [...spread, "+write-mask"], expected: "878e58ff7a9fc4ffd0f51aff587da2ffc7ec11ffb7dc37ffcd3358ff587da2ff8bb027ffb03a5fff6186abffd0f51aff" },
    { name: "negate after mask removal", options: [...spread, "+write-mask", "-negate"], expected: "7871a7ff85603bff2f0ae5ffa7825dff3813eeff4823c8ff32cca7ffa7825dff744fd8ff4fc5a0ff9e7954ff2f0ae5ff" },
    { name: "negate through original mask", options: ["-negate", "+write-mask"], expected: "f4cfaaff7a9fc4ff16f1ccff587da2ffc7ec11ffc9a47fff5a3510ffebc6a1ff7c5732ff0de8c3ff6186abffd0f51aff" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: spread preserves native $name`, async ({ options, expected }) => {
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.ppm", "-write-mask", "/mask.pgm", ...options, "-depth", "8", "rgba:-"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            expect(Buffer.concat(chunks).toString("hex")).toBe(expected);
        } else {
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            expect(Buffer.from(result.stdoutBytes ?? []).toString("hex")).toBe(expected);
        }
    });
}
