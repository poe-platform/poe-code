import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: RGBA8 and big-endian CMYKA16.
const cases = [
    { background: "gray50", rgba: "7f7f7fff", cmyka: "0000000000008080ffff" },
    { background: "gray(127)", rgba: "7f7f7fff", cmyka: "0000000000008080ffff" },
    { background: "graya(50%,0.5)", rgba: "80808080", cmyka: "00000000000080008000" },
    { background: "#7f7f7f", rgba: "363636ff", cmyka: "000000000000c9aaffff" },
    { background: "rgb(127,127,127)", rgba: "363636ff", cmyka: "000000000000c9aaffff" },
    { background: "black", rgba: "000000ff", cmyka: "000000000000ffffffff" },
    { background: "white", rgba: "ffffffff", cmyka: "0000000000000000ffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "cmyka"] as const) {
        it.each(cases)(`${mode}: CMYK splice preserves $background in ${format}`, async ({ background, rgba, cmyka }) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const argv = ["xc:#b2346680", "-colorspace", "CMYK", "-background", background, "-splice", "1x0+1+0",
                ...(format === "rgba" ? ["-colorspace", "sRGB", "-depth", "8"] : ["-depth", "16", "-endian", "MSB"]), `${format}:/out`];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(format === "rgba" ? `b2346680${rgba}` : `0000b5366d4d4d4d8080${cmyka}`);
        });
    }
}
