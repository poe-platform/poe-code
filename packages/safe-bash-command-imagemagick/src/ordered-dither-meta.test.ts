import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { selection: [], dither: true, expected: "5555" },
        { selection: ["-channel", "Meta0"], dither: true, expected: "5555" },
        { selection: ["-channel", "R"], dither: true, expected: "0a5a" },
        { selection: [], dither: false, expected: "0a5a" },
        { selection: ["-channel", "Default"], dither: true, expected: "5555" },
        { selection: ["-channel", "R", "+channel"], dither: true, expected: "5555" },
        { selection: [], dither: true, levels: "o4x4,2,3,4,5,6", expected: "3366" },
        { selection: ["-channel", "Meta0"], dither: true, levels: "o4x4,2,3,4,5,6", expected: "8080" },
        { selection: ["-channel", "R,Meta0"], dither: true, levels: "o4x4,2,3,4,5,6", expected: "5555" },
    ])(`${mode}: ordered dithering extra channels %j`, async ({ selection, dither, expected, levels }) => {
        const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);
        const argv = ["/in.ppm", "-channel-fx", "red=>meta0", ...selection,
            ...(dither ? ["-ordered-dither", levels ?? "o4x4,4"] : []),
            "-channel", "Meta0", "-separate", "-depth", "8", "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
