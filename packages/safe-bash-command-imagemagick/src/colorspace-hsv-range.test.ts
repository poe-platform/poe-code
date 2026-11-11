import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI wraps HSV/HSB hue, including interpolated overshoot.
for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    for (const space of ["HSV", "HSB"] as const) {
        it.each([
            ["-125%", "8030d0ff"], ["-10%", "d03090ff"], ["0%", "d03030ff"],
            ["25%", "80d030ff"], ["100%", "d03030ff"], ["110%", "d09030ff"],
            ["125%", "80d030ff"], ["225%", "80d030ff"]
        ])(`${mode}: ${space} hue %s converts to sRGB`, async (hue, expected) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const args = ["xc:#d03060", "-colorspace", space, "-channel", "R", "-evaluate", "set", hue!,
                "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += Buffer.from(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}

it.each([false, true])("matches native HSV deskew pixels (nearest=%s)", async nearest => {
    const data = new Uint8Array(32 * 16 * 3);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
        data.set((y - Math.floor(x / 8) + 7) % 7 < 2 ? [12, 32, 74] : [237, 249, 218], (y * 32 + x) * 3);
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", Buffer.concat([Buffer.from("P6\n32 16\n255\n"), data]));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: ["/in.ppm", "-colorspace", "HSV",
            ...(nearest ? ["-filter", "Point", "-interpolate", "nearest"] : []),
            "-deskew", "40%", "-colorspace", "sRGB", "-depth", "8", "rgba:-"],
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += Buffer.from(bytes); } }
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = Buffer.concat(chunks);
    expect(output.length).toBe(2800);
    expect(createHash("sha256").update(output).digest("hex")).toBe(nearest
        ? "03ac597cafad1d52704beee313b6c7b3935354c7ea70e80b4fd77ecd4219f4cc"
        : "df92a162b069dea21bb4b6889d51dd0f3e78be6514fe497bde5cc75283d0d2a9");
});
