import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with the mask cleared before encoding.
const cases = [
    { name: "write mask", before: ["-write-mask", "mask.pgm"], after: ["+write-mask"], rgba: "202020ffc8c8c8ff606060ffc8c8c8ffb0b0b0ffc8c8c8ff" },
    { name: "region", before: ["-region", "1x1+1+0"], after: ["+region"], rgba: "202020ffc8c8c8ff202020ff404040ff202020ff111111ff" },
    { name: "write mask across chunks", rows: 257, before: ["-write-mask", "mask.pgm"], after: ["+write-mask"], rgba: "202020ffc8c8c8ff606060ffc8c8c8ffb0b0b0ffc8c8c8ff" },
    { name: "region across chunks", rows: 257, before: ["-region", "1x257+1+0"], after: ["+region"], rgba: "202020ffc8c8c8ff202020ff404040ff202020ff111111ff" },
    { name: "unrestricted control", before: [], after: [], rgba: "202020ffc8c8c8ff606060ff404040ffb0b0b0ff111111ff" },
];

for (const evaluate of [false, true])
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: separates channels with $name, evaluate=${evaluate}`, async ({ before, after, rgba, rows = 1 }) => {
        const files = new Map([
            ["in.pam", Buffer.concat([Buffer.from(`P7\nWIDTH 2\nHEIGHT ${rows}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), Buffer.from("2060b080c84011ef".repeat(rows), "hex")])],
            ["mask.pgm", Buffer.concat([Buffer.from(`P5\n2 ${rows}\n255\n`), Buffer.from("00ff".repeat(rows), "hex")])],
            ["out", Buffer.from("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["in.pam", ...(evaluate ? ["-evaluate", "Add", "0"] : []), "-alpha", "off", ...before, "-separate", ...after, "-append", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe([0, 16, 32].map(offset => rgba.slice(offset, offset + 16).repeat(rows)).join(""));
    });
}
