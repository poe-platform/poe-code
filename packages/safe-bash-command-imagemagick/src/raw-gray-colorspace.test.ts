import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete big-endian output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { space: "LinearGray", extract: false, hex: "8080" },
    { space: "RGB", extract: false, hex: "8080" },
    { space: "RGB", extract: true, hex: "89bebc94e1e1" },
    { space: "YUV", extract: true, hex: "53e88058acc9" },
    { space: "Lab", extract: true, hex: "762277dfa200" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const explicit of [false, true]) {
        for (const destination of ["stdout", "file", "write"] as const) {
            it.each(cases)(`${mode} ${destination}: $space extract=$extract, explicit Gray=${explicit}`, async ({ space, extract, hex }) => {
                const input = extract ? ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append"] : ["xc:#808080"];
                const output = `gray:${destination === "stdout" ? "-" : "/out.gray"}`;
                const argv = [...input, "-colorspace", space, ...(extract ? ["-alpha", "extract"] : []),
                    ...(explicit ? ["-colorspace", "Gray"] : []), "-depth", "16", "-endian", "MSB",
                    ...(destination === "write" ? ["-write", output, "null:"] : [output])];
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const bytes = destination === "stdout"
                    ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
                    : mode === "command" ? await fs.readFile("/out.gray") : files.get("/out.gray")!;
                expect(Buffer.from(bytes).toString("hex")).toBe(hex);
            });
        }
    }
}
