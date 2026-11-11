import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: retain gray quantum fractions until output.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { name: "palette mean", inputs: ["xc:#dcbe28", "xc:#c8b42d", "+append"], options: ["-colors", "1"], depth: "8", expected: "b4b4b4b4b4b4" },
        { name: "16-bit sample", inputs: ["xc:#0a46dc"], options: ["-colors", "16"], depth: "16", expected: "445644564456" },
        { name: "unique palette sample", inputs: ["xc:#0a46dc"], options: ["-colors", "16", "-unique-colors"], depth: "16", expected: "445644564456" },
        { name: "samples across raster chunks", inputs: ["-size", "1025x1", "xc:#0a46dc"], options: ["-colors", "16"], depth: "16", expected: "445644564456".repeat(1025) },
    ])(`retains gray quantization precision for $name (${mode})`, async ({ inputs, options, depth, expected }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [...inputs, "-quantize", "Gray", ...options, "-depth", depth, "-endian", "MSB", "rgb:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const bytes = mode === "retained" || mode === "public" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
