import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps auxiliary planes on separated gray images.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "red channel count", channel: "R", info: true },
        { name: "alpha channel count", channel: "A", info: true },
        { name: "Meta0 after red", channel: "R", extractMeta: true },
        { name: "Meta0 after alpha", channel: "A", extractMeta: true },
        { name: "red samples", channel: "R", expected: "00".repeat(20) },
        { name: "alpha samples", channel: "A", expected: "ff".repeat(20) },
        { name: "direct Meta0", channel: "Meta0" },
        { name: "repeated Meta0", channel: "Meta0", extractMeta: true },
        { name: "16-bit Meta0 across chunks", channel: "R", extractMeta: true, width: 513, depth: 16 },
    ])(`${mode}: $name`, async ({ channel, info, extractMeta, expected, width = 5, depth = 8 }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", `${width}x4`, "xc:black", "xc:black", "xc:black", "xc:white",
            "gradient:black-white", "-combine", "-channel", channel, "-separate", "+channel",
            ...(extractMeta ? ["-channel", "Meta0", "-separate", "+channel"] : []),
            ...(info ? ["-format", "%[channels]", "info:/out"] : ["-depth", String(depth), "-endian", "MSB", "gray:/out"])];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (info) expect(new TextDecoder().decode(output)).toBe("gray  2.1");
        else expect(Buffer.from(output).toString("hex")).toBe(expected ??
            ["00", "55", "aa", "ff"].map(value => value.repeat(width * depth / 8)).join(""));
    });
}
