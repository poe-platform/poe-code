import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native GIF frames: red at 16 centiseconds, blue at 36 centiseconds.
const red = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const blue = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { args: ["a.gif", "b.gif", "-set", "delay", "1x1000"], timing: [[1, 1000], [1, 1000]] },
        { args: ["a.gif", "b.gif", "-set", "delay", "12x24"], timing: [[12, 24], [12, 24]] },
        { args: ["a.gif", "b.gif", "-set", "delay", "7x20"], timing: [[7, 20], [7, 20]] },
        { args: ["a.gif", "b.gif", "-set", "delay", "16"], timing: [[16, 100], [16, 100]] },
        { args: ["a.gif", "b.gif"], timing: [[16, 100], [36, 100]] },
        { args: ["-delay", "1x1000", "a.gif", "-delay", "12x24", "b.gif"], timing: [[1, 1000], [12, 24]] },
        { args: ["a.gif", "-set", "delay", "0x24"], timing: [[0, 24]] },
        { args: [...Array.from({ length: 17 }, () => ["a.gif", "b.gif"]).flat(), "-set", "delay", "7x20"], timing: Array.from({ length: 34 }, () => [7, 20]) },
    ])(`preserves MIFF delay counts and tick rates in ${mode}: $args`, async ({ args, timing }) => {
        const files = new Map<string, Uint8Array>([["a.gif", red], ["b.gif", blue], ["out.miff", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argv = [...args, "out.miff"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argv, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.miff") : files.get("out.miff")!;
        let offset = 0;
        for (const [index, [delay, ticks]] of timing.entries()) {
            const end = output.indexOf(26, offset);
            expect(end).toBeGreaterThan(offset);
            const header = new TextDecoder().decode(output.subarray(offset, end));
            expect(header.split("\n")).toContain(`delay=${delay}`);
            expect(header.split("\n")).toContain(`ticks-per-second=${ticks}`);
            const original = decodeImage(index % 2 ? blue : red);
            const decoded = decodeImage(output.subarray(offset));
            expect(decoded).toMatchObject({ width: original.width, height: original.height, data: original.data });
            offset = end + 1 + decoded.width * decoded.height * decoded.channels * (decoded.depth === "ushort" ? 2 : 1);
        }
        expect(offset).toBe(output.length);
    });
}
