import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, seed 123, two-pixel PPM input.
const rgb8 = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
const rgb16 = Buffer.from("50360a3220310a36353533350a0a0314041dd959dc6e218215", "hex");
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { name: "8-bit input to 16-bit sketch", input: rgb8, operation: ["-sketch", "0x1+45"], depth: "16", format: "rgb", expected: "12c7258e3855ffffffffffff" },
        { name: "Gray working samples", input: rgb8, operation: ["-colorspace", "Gray", "-sketch", "0x1+45"], depth: "8", format: "gray", expected: "23ff" },
        { name: "8-bit sketch", input: rgb8, operation: ["-sketch", "0x1+45"], depth: "8", format: "rgb", expected: "132538ffffff" },
        { name: "8-bit input without sketch", input: rgb8, operation: [], depth: "16", format: "rgb", expected: "0a0a14141e1e5a5a6e6e8282" },
        { name: "16-bit input sketch", input: rgb16, operation: ["-sketch", "0x1+45"], depth: "16", format: "rgb", expected: "12ba257037d4ffffffffffff" },
        { name: "16-bit input without sketch", input: rgb16, operation: [], depth: "16", format: "rgb", expected: "0a0314041dd959dc6e218215" }
    ])(`${mode}: $name`, async ({ input, operation, depth, format, expected }) => {
        const argv = ["-seed", "123", "in.ppm", ...operation, "-depth", depth, "-endian", "MSB", `${format}:-`];
        const files = new Map([["in.ppm", input]]), fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
        await fs.writeFile("/in.ppm", input);
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
            fs, signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
