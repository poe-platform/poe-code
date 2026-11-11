import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, raw RGB at depth 8.
for (const width of [2, 1032]) for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "over-range enhancement", options: ["-enhance"], expected: "465a784d617f" },
        { name: "explicit clamp", options: ["-clamp", "-enhance"], expected: "404040404040" },
        { name: "scale control", options: [], expected: "465a784d617f" },
    ])(`preserves enhancement samples for $name via ${mode} at width ${width}`, async ({ options, expected }) => {
        const input = new Uint8Array([...new TextEncoder().encode(`P6\n${width} 1\n255\n`), ...Array.from({ length: width * 3 }, (_, i) => [70, 90, 120, 77, 97, 127][i % 6]!)]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-evaluate", "multiply", "4", ...options,
            "-evaluate", "multiply", "0.25", "-depth", "8", "rgb:/out.raw"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(width / 2));
    });
}
