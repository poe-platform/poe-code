import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (37 * i + 11) % 256))]);
const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from([0, 255, 0, 255, 255, 0, 0, 0, 0, 0, 255, 255])]);
const statistics = ["-format", "%[fx:minima.r],%[fx:mean.r],%[fx:maxima.r]", "info:-"];
const cases = [
    { name: "displaced read mask", options: ["-read-mask", "/mask.pgm", "-seed", "17", "-spread", "2", ...statistics], expected: "0.345098,0.522164,0.815686" },
    { name: "removed read mask", options: ["-read-mask", "/mask.pgm", "-seed", "17", "-spread", "2", "+read-mask", ...statistics], expected: "0.0431373,0.538256,0.815686" },
    { name: "original read mask", options: ["-read-mask", "/mask.pgm", ...statistics], expected: "0.345098,0.56,0.815686" },
    { name: "unmasked pixels", options: ["-seed", "17", "-spread", "2", "-depth", "8", "rgba:-"], expected: "878e58ff795d82ffd0f51aff587da2ff0b3055ffb7dc37ffcd3358ff587da2ff8bb027ffb03a5fffbc496eff698ea0ff", raw: true }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: spread preserves native $name`, async ({ options, expected, raw }) => {
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.ppm", ...options];
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            expect(Buffer.concat(chunks).toString(raw ? "hex" : "utf8")).toBe(expected);
        } else {
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            expect(raw ? Buffer.from(result.stdoutBytes!).toString("hex") : result.stdout).toBe(expected);
        }
    });
}
