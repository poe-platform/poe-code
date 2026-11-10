import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("3060b080a04020e0802050b0c01030607733bb90808020c0", "hex")
]);
const mask = Buffer.concat([Buffer.from("P5\n3 2\n255\n"), Buffer.from([0, 64, 255, 255, 128, 0])]);
// ImageMagick 7.1.2-35 Q16-HDRI: in.pam <operations> -negate -depth 8 rgba:out.
const sheared = "423319005b888b00569f940020382c00185a4e004d7326006060a80000000000";
const masked = "cf9f4f7f281d19e05b2741b03b3c3c60343633907f7fdf3f";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { name: "mask before nonzero shear", operations: ["-write-mask", "/mask.pgm", "-shear", "20x0"], hex: sheared },
    { name: "unmasked shear", operations: ["-shear", "20x0"], hex: sheared },
    { name: "mask without shear", operations: ["-write-mask", "/mask.pgm"], hex: masked },
    { name: "mask before identity shear", operations: ["-write-mask", "/mask.pgm", "-shear", "0x0"], hex: masked }
])(`${mode}: $name before negate`, async ({ operations, hex }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>([["/in.pam", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.pam", ...operations, "-negate", "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
