import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: extract the entire fifth plane after clearing selection.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "write mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", shade: true, expected: "803880" },
        { name: "region", before: ["-region", "1x1+0+0"], after: ["+region"], channel: "Meta0", shade: true, expected: "803848" },
        { name: "default mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Default", shade: true, expected: "805080" },
        { name: "alpha mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "A,Meta0", shade: true, expected: "805080" },
        { name: "disabled alpha", before: ["-alpha", "off", "-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", shade: true, expected: "808080" },
        { name: "16-bit mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", shade: true, depth: "16", expected: "800038508000" },
        { name: "16-bit region", before: ["-region", "1x1+0+0"], after: ["+region"], channel: "Meta0", shade: true, depth: "16", expected: "800038504870" },
        { name: "partial mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", shade: true, depth: "16", maskSamples: "808080", expected: "20202c44345c" },
        { name: "unmasked", before: [], after: [], channel: "Meta0", shade: true, expected: "808080" },
        { name: "mask without shading", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", shade: false, expected: "2080c0" },
        { name: "red only", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "R", shade: true, expected: "2080c0" },
    ])(`${mode}: shade fifth channel with $name`, async ({ before, after, channel, shade, expected, depth = "8", maskSamples = "00ff00" }) => {
        const argv = ["-size", "3x1", "xc:#404040", "-duplicate", "3",
            "(", "+size", "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine",
            ...before, "-channel", channel, ...(shade ? ["-shade", "45x30"] : []), "+channel", ...after,
            "-channel", "Meta0", "-separate", "+channel", "-depth", depth, "-endian", "MSB", mode === "command" ? "gray:-" : "gray:/out"];
        const mask = Buffer.from("50350a3320310a3235350a" + maskSamples, "hex");
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/mask.pgm", mask]]);
        await fs.writeFile("/mask.pgm", mask);
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
