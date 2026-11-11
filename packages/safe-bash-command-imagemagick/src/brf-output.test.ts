import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including its odd-width cell sampling.
const input = Buffer.from("P1\n3 5\n1 0 0\n0 1 0\n0 0 1\n1 0 0\n0 1 1\n");
for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    for (const write of [false, true]) {
        it.each([
            { output: "BRF:-", options: [], hex: "57696474683a20340a4865696768743a20350a0a2a270a41200a" },
            { output: "BRF:out.bin", options: ["-set", "label", "Sample", "-repage", "9x8+1+2"], hex: "5469746c653a2053616d706c650a583a20310a593a20320a57696474683a20340a4865696768743a20350a0a2a270a41200a" },
            { output: "out.brf", options: [], hex: "57696474683a20340a4865696768743a20350a0a2a270a41200a" },
            { output: "pbm:-", options: [], hex: "50340a3320350a8040208060" },
        ])(`writes native BRF destinations and PBM control (${mode}, write=${write}): $output`, async ({ output, options, hex }) => {
            const fs = new MemoryFileSystem(), files = new Map([["in.ppm", input]]);
            await fs.writeFile("/in.ppm", input);
            const args = ["in.ppm", ...options, ...(write ? ["-write", output, "null:"] : [output])];
            let stdout = Buffer.alloc(0), stderr = "";
            if (mode === "command") {
                const result = await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout = Buffer.concat([stdout, bytes]); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect(result.exitCode).toBe(0);
            } else {
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                expect(result.exitCode).toBe(0);
                stdout = Buffer.from(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
                stderr = result.stderr;
            }
            expect(stderr).toBe("");
            const path = output.endsWith(":-") ? undefined : output === "out.brf" ? "out.brf" : "out.bin";
            const buffered = mode === "sync" || mode === "buffered";
            const bytes = path ? buffered ? files.get(path) : await fs.readFile(`/${path}`) : stdout;
            expect(Buffer.from(bytes ?? []).toString("hex")).toBe(hex);
            if (path) expect(stdout.length).toBe(0);
            expect((buffered ? [...files.keys()] : (await fs.readdir("/")).map(entry => entry.name)).sort()).toEqual(["in.ppm", ...(path ? [path] : [])].sort());
        });
    }
}

// Native output hashes cover partial cells, even dimensions, and bounded reads.
for (const mode of ["buffered", "retained"] as const) {
    it.each([
        { width: 1, height: 1, hash: "3b7b71b59053b00487923d2ee5a2ba1321d9efe8ced36808138ff0c9493a6537" },
        { width: 2, height: 1, hash: "3b7b71b59053b00487923d2ee5a2ba1321d9efe8ced36808138ff0c9493a6537" },
        { width: 4, height: 3, hash: "b8a03759806ee028169e75ad3e549036856bfe5b1bd1289d378b534b67448343" },
        { width: 2051, height: 7, hash: "fee403e7d46d48b16b81994e0749c23b0b2039f3c0958d75ea1c704a6615af95" },
    ])(`matches native BRF cells for $width x $height (${mode})`, async ({ width, height, hash }) => {
        const bitmap = Buffer.from(`P1\n${width} ${height}\n${Array.from({ length: width * height }, (_, i) => (i * 17 + Math.floor(i / width) * 13) % 31 < 14 ? 1 : 0).join(" ")}\n`);
        const files = new Map([["/in.pbm", bitmap]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pbm", bitmap);
        const result = await runConvertCli(["/in.pbm", "brf:-"], mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(createHash("sha256").update(result.stdoutBytes!).digest("hex")).toBe(hash);
    });
}
