import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: compare the four ink samples, including black.
const mask = Buffer.concat([Buffer.from("P5\n3 1\n255\n"), Buffer.from([255, 0, 255])]);
const cases = [
    { name: "write mask", before: ["-write-mask", "/mask.pgm"], after: ["+write-mask"], expected: "ca6500a9ca6500a900224401" },
    { name: "equivalent region", before: ["-region", "1x1+1+0"], after: ["+region"], expected: "ca6500a9ca6500a900224401" },
    { name: "unmasked", before: [], after: [], expected: "00224401ca6500a9542a0030" },
    { name: "cleared mask", before: ["-write-mask", "/mask.pgm", "+write-mask"], after: [], expected: "00224401ca6500a9542a0030" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`preserves protected CMYK roll pixels: $name (${mode})`, async ({ before, after, expected }) => {
        const files = new Map([["/mask.pgm", mask]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/mask.pgm", mask);
        const args = ["xc:#123456", "xc:#8badcf", "xc:#fedcba", "+append", "-colorspace", "CMYK",
            ...before, "-roll", "+1+0", ...after, "-depth", "8", "cmyk:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
