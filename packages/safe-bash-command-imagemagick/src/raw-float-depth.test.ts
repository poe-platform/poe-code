import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("50360a3220310a3235350a0a141e5a6e82", "hex");

// ImageMagick 7.1.2-35 Q16-HDRI, requested depth 12, MSB output.
const fixtures = [
    { coder: "rgb", floating: true, hex: "29082d042f8835a536e63814" },
    { coder: "rgba", floating: true, hex: "29082d042f88380035a536e638143800" },
    { coder: "bgr", floating: true, hex: "2f882d042908381436e635a5" },
    { coder: "bgra", floating: true, hex: "2f882d0429083800381436e635a53800" },
    { coder: "rgb", floating: false, hex: "0a11411e25a56e6828" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const endian of ["MSB", "LSB"]) {
        it.each(fixtures)(`${mode}, ${endian}: depth 12 $coder, floating=$floating`, async ({ coder, floating, hex }) => {
            const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
            await fs.writeFile("/in.ppm", input);
            const args = ["/in.ppm", "-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel",
                "-depth", "12", "-endian", endian, ...(floating ? ["-define", "quantum:format=floating-point"] : []),
                "-write", `${coder}:/copy`, `${coder}:-`];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const expected = Buffer.from(hex, "hex");
            if (floating && endian === "LSB") expected.swap16();
            const output = mode === "command" ? Buffer.concat(stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(output)).toEqual(expected);
            expect(Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/copy") : files.get("/copy")!)).toEqual(expected);
        });
    }
}
