import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGBA output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { canvas: "#5090c080", stroke: "#b0503080", options: [], expected: "582818ff69433bd95f6576a6588ab386588ab3865f6576a669433bd9582818ff" },
        { canvas: "#5090c0ff", stroke: "#b0503080", options: [], expected: "582818ff654e4eff5a748fff548db9ff548db9ff5a748fff654e4eff582818ff" },
        { canvas: "#5090c080", stroke: "#b0503080", options: ["-fill", "none"], expected: "906560c08a6968b86f7b9298588ab386588ab3866f7b92988a6968b8906560c0" },
        { canvas: "#5090c080", stroke: "#b05030ff", options: [], expected: "b05030ffa24d32f6795e5fbb6085a78c6085a78c795e5fbba24d32f6b05030ff" },
    ])(`${mode}: composites line fill and stroke on $canvas with $stroke $options`, async ({ canvas, stroke, options, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", "4x2", `xc:${canvas}`, "-stroke", stroke, ...options,
            "-draw", "line 0,0 3,1", "-depth", "8", "rgba:out.rgba"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
