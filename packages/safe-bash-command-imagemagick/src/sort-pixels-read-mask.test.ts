import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference: the read mask travels with sorted pixels.
const cases = [
    { name: "mask before sorting", operations: ["-read-mask", "mask.pgm", "-sort-pixels"], expected: "0.414902" },
    { name: "mask after sorting", operations: ["-sort-pixels", "-read-mask", "mask.pgm"], expected: "0.402353" },
    { name: "cleared mask", operations: ["-read-mask", "mask.pgm", "-sort-pixels", "+read-mask"], expected: "0.471078" },
    { name: "unmasked sorting", operations: ["-sort-pixels"], expected: "0.471078" },
    { name: "unsorted mask", operations: ["-read-mask", "mask.pgm"], expected: "0.414902" },
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`${mode}: preserves read-mask statistics with $name`, async ({ operations, expected }) => {
        const input = Buffer.concat([Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            Buffer.from("d02030302050e000d0203030608040f01122330080808070808080e090102080", "hex")]);
        const mask = Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.from([0, 255, 255, 0, 255, 0, 255, 255])]);
        const files = new Map<string, Uint8Array>([["in.pam", input], ["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const argv = ["in.pam", "-alpha", "opaque", ...operations, "-format", "%[fx:mean.r]", "info:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
