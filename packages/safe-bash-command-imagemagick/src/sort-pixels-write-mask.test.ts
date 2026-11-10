import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const cases = [
    {
        name: "carries the mask through sorting for subsequent edits",
        operations: ["-write-mask", "mask.pgm", "-sort-pixels", "-negate", "+write-mask"],
        expected: "2fdfcf002050e0ffd02030ff9f7fbf00112233ff901020ff7f7f7f00901020ff"
    },
    {
        name: "attaches a mask after sorting at its original coordinates",
        operations: ["-sort-pixels", "-write-mask", "mask.pgm", "-negate", "+write-mask"],
        expected: "2fdfcf00d02030ff2050e0ff9f7fbf00112233ff6fefdf00808080ff808080ff"
    },
    {
        name: "clears the sorted mask before subsequent edits",
        operations: ["-write-mask", "mask.pgm", "-sort-pixels", "+write-mask", "-negate"],
        expected: "2fdfcf00dfaf1f002fdfcf009f7fbf00eeddcc006fefdf007f7f7f006fefdf00"
    },
    {
        name: "sorts without a mask",
        operations: ["-sort-pixels", "-negate"],
        expected: "2fdfcf002fdfcf00dfaf1f009f7fbf00eeddcc006fefdf007f7f7f007f7f7f00"
    },
    {
        name: "applies the mask without sorting",
        operations: ["-write-mask", "mask.pgm", "-negate", "+write-mask"],
        expected: "2fdfcf002050e0ffd02030ff9f7fbf00112233ff7f7f7f00808080ff901020ff"
    }
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI reference outputs, including stable intensity ties.
    it.each(cases)(`${mode}: $name`, async ({ operations, expected }) => {
        const files = new Map([
            ["in.pam", Uint8Array.from([
                ...new TextEncoder().encode("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
                ...Buffer.from("d02030302050e000d0203030608040f01122330080808070808080e090102080", "hex")
            ])],
            ["mask.pgm", Uint8Array.from([...new TextEncoder().encode("P5\n4 2\n255\n"), 0, 255, 255, 0, 255, 0, 255, 255])],
            ["out", new TextEncoder().encode("KEEP")]
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["in.pam", "-alpha", "opaque", ...operations, "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
