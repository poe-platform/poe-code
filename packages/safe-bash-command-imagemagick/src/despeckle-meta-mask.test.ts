import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: compare the entire fifth channel after removing the mask.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "write mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", filter: true, expected: "1436b0" },
        { name: "region", before: ["-region", "1x1+0+0"], after: ["+region"], channel: "Meta0", filter: true, expected: "143651" },
        { name: "default channels with mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Default", filter: true, expected: "1417b0" },
        { name: "default channels with region", before: ["-region", "1x1+0+0"], after: ["+region"], channel: "Default", filter: true, expected: "141723" },
        { name: "16-bit mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", filter: true, depth: "16", expected: "14143625b0b0" },
        { name: "disabled alpha", before: ["-alpha", "off", "-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", filter: true, expected: "1480b0" },
        { name: "partial mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", filter: true, maskSamples: "808080", expected: "082a3f" },
        { name: "red and fifth channel", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "R,Meta0", filter: true, expected: "1424b0" },
        { name: "alpha and fifth channel", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "A,Meta0", filter: true, expected: "1423b0" },
        { name: "16-bit default mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Default", filter: true, depth: "16", expected: "141416feb0b0" },
        { name: "16-bit partial mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", filter: true, depth: "16", maskSamples: "808080", expected: "087429bc3f0b" },
        { name: "unmasked", before: [], after: [], channel: "Meta0", filter: true, expected: "1474b0" },
        { name: "mask without filtering", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], channel: "Meta0", filter: false, expected: "2080c0" },
        { name: "unselected fifth channel", before: ["-region", "1x1+0+0"], after: ["+region"], channel: "R", filter: true, expected: "2080c0" },
    ])(`${mode}: despeckle fifth channel with $name`, async ({ before, after, channel, filter, expected, depth = "8", maskSamples = "00ff00" }) => {
        const argv = ["-size", "3x1", "xc:#404040", "-duplicate", "3",
            "(", "+size", "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine",
            ...before, "-channel", channel, ...(filter ? ["-despeckle"] : []), "+channel", ...after,
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
