import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("3060b080a04020e0802050b0c01030607733bb90808020c0", "hex")
]);
const mask = Buffer.concat([Buffer.from("P5\n3 2\n255\n"), Buffer.alloc(6, 255)]);
// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for these exact PAM/PGM bytes.
const cases = [
    { name: "mask before shear", operations: ["-read-mask", "full.pgm", "-shear", "20x0"], expected: "0" },
    { name: "mask after shear", operations: ["-shear", "20x0", "-read-mask", "full.pgm"], expected: "1" },
    { name: "mask removed after shear", operations: ["-read-mask", "full.pgm", "-shear", "20x0", "+read-mask"], expected: "1" },
    { name: "shear without mask", operations: ["-shear", "20x0"], expected: "1" },
    { name: "identity shear", operations: ["-read-mask", "full.pgm", "-shear", "0x0"], expected: "1" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native shear read-mask statistics: $name, ${mode}`, async ({ operations, expected }) => {
        const files = new Map([["in.pam", input], ["full.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["in.pam", ...operations, "-format", "%[fx:mean.r>0.01]", "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(bytes)).toBe(expected);
    });
}
