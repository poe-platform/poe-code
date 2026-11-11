import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: packed BGR floats use RGB order at 32/64 bits.
const cases = [
    ...[
        { depth: 16, rgb: "2c8532873565", bgr: "356532872c85", alpha: "3804" },
        { depth: 32, rgb: "3d9090913e50d0d13eacacad", bgr: "3d9090913e50d0d13eacacad", alpha: "3f008081" },
        { depth: 64, rgb: "3fb21212121212123fca1a1a1a1a1a1a3fd5959595959596", bgr: "3fb21212121212123fca1a1a1a1a1a1a3fd5959595959596", alpha: "3fe0101010101010" },
    ].flatMap(({ depth, rgb, bgr, alpha }) => ["rgb", "bgr", "bgra", "bgro"].map(coder => ({
        coder, depth, format: "floating-point", interlace: "None",
        hex: (coder === "rgb" ? rgb : bgr) + (coder === "bgra" ? alpha : ""),
    }))),
    ...["bgr", "bgra", "bgro"].flatMap(coder => [
        { coder, depth: 32, format: "floating-point", interlace: "Line", hex: "3eacacad3e50d0d13d909091" + (coder === "bgra" ? "3f008081" : "") },
        { coder, depth: 32, format: "floating-point", interlace: "Plane", hex: "3d9090913e50d0d13eacacad" + (coder === "bgra" ? "3f008081" : "") },
        { coder, depth: 32, format: "unsigned", interlace: "None", hex: "565656563434343412121212" + (coder === "bgra" ? "80808080" : "") },
    ]),
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const endian of ["MSB", "LSB"]) {
        it.each(cases)(`${mode} ${endian}: $coder $depth-bit $format $interlace channel order`, async ({ coder, depth, format, interlace, hex }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const args = ["xc:#12345680", "-depth", String(depth), "-endian", endian, "-define", `quantum:format=${format}`,
                "-interlace", interlace, "-write", `${coder}:/out`, `${coder}:-`];
            const argumentValues = createCommandArguments(args);
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const expected = Buffer.from(hex, "hex");
            if (endian === "LSB") {
                if (depth === 16) expected.swap16();
                else if (depth === 32) expected.swap32();
                else expected.swap64();
            }
            expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("/out")!)).toEqual(expected);
            expect(Buffer.from(mode === "command" ? Buffer.concat(stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array())).toEqual(expected);
        });
    }
}
