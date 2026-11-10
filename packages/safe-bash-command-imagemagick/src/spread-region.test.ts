import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (37 * i + 11) % 256))]);
const spread = ["-seed", "17", "-spread", "2"];
const cases = [
    { name: "active displaced region", operations: spread, hex: "0b3055ff7a9fc4ffe90e33ff587da2ffc7ec11ffb7dc37ffcd3358ff14395eff83a8cdfff2173cff6186abffd0f51aff" },
    { name: "negate through displaced region", operations: [...spread, "-negate", "+region"], hex: "6f7479ff7b9cbdffe90e33ff587da2ffc7ec11ffb6da38ffcd3358ff14395eff83a8cdfff2173cff6186abffd0f51aff" },
    { name: "cleared displaced region", operations: [...spread, "+region"], hex: "0b3055ff7a9fc4ffe90e33ff587da2ffc7ec11ffb7dc37ffcd3358ff14395eff83a8cdfff2173cff6186abffd0f51aff" },
    { name: "negate after clearing region", operations: [...spread, "+region", "-negate"], hex: "f4cfaaff85603bff16f1ccffa7825dff3813eeff4823c8ff32cca7ffebc6a1ff7c5732ff0de8c3ff9e7954ff2f0ae5ff" },
    { name: "original rectangular region", operations: ["-negate", "+region"], hex: "0b3055ff7a9fc4ffe90e33ff587da2ffc7ec11ffc9a47fff5a3510ff14395eff83a8cdfff2173cff6186abffd0f51aff" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ operations, hex }) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const files = new Map([["/in.ppm", input]]);
        const args = ["/in.ppm", "-region", "2x1+1+1", ...operations, "-depth", "8", "rgba:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
