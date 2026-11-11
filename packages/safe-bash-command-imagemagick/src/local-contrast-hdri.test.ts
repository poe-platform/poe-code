import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PPM pixels 0a141e5a6e82, raw RGB at depth 8.
const cases = [
    { name: "over-range output", options: ["-local-contrast", "250x200", "-evaluate", "multiply", "0.25"], hex: "060b11435261" },
    { name: "zero strength with over-range input", options: ["-evaluate", "multiply", "4", "-local-contrast", "250x0", "-evaluate", "multiply", "0.25"], hex: "0a141e5a6e82" },
    { name: "over-range input and output", options: ["-evaluate", "multiply", "4", "-local-contrast", "250x50", "-evaluate", "multiply", "0.25"], hex: "0d1a2887a4c2" },
    { name: "explicit clamp", options: ["-local-contrast", "250x200", "-clamp", "-evaluate", "multiply", "0.25"], hex: "060b11404040" },
    { name: "scale control", options: ["-evaluate", "multiply", "4", "-evaluate", "multiply", "0.25"], hex: "0a141e5a6e82" },
    { name: "ordinary contrast", options: ["-local-contrast", "250x50"], hex: "0d1a2887a4c2" },
    // Signed sample and channel-isolation controls expose clipping before encoding.
    { name: "zero strength with negative input", options: ["-evaluate", "multiply", "-1", "-local-contrast", "250x0", "-evaluate", "multiply", "-1"], hex: "0a141e5a6e82" },
    { name: "negative input and output", options: ["-evaluate", "multiply", "-1", "-local-contrast", "250x50", "-evaluate", "multiply", "-1"], hex: "0d1a2887a4c2" },
    { name: "negative contrast output", options: ["-local-contrast", "0x-200", "-evaluate", "multiply", "-1"], hex: "0a141e5a6e82" },
    { name: "unselected over-range channels", options: ["-evaluate", "multiply", "4", "-channel", "R", "-local-contrast", "250x50", "+channel", "-evaluate", "multiply", "0.25"], hex: "0d141e876e82" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`retains local contrast samples for $name via ${mode}`, async ({ options, hex }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...options, "-depth", "8", "rgb:/out.raw"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
