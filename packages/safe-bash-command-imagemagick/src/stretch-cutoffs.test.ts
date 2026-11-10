import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, <input> <operation> <cutoffs> -endian MSB -depth 8 rgb:out.
const input = new TextEncoder().encode(`P3
4 2
255
19 61 200 91 125 39 120 85 65 198 183 17
213 210 98 220 90 179 67 85 190 141 184 70
`);
const keep = new TextEncoder().encode("KEEP");
const cases = [
    ["-contrast-stretch", "+1+2", ""],
    ["-linear-stretch", "-1-2", ""],
    ["-contrast-stretch", "1.2.3", ""],
    ["-linear-stretch", "1e+", ""],
    ["-contrast-stretch", "+1", "0000ff076c005d0000ffff00ffff1cff04ff0000ff9cff00"],
    ["-linear-stretch", "2x1+2+3", "0000f9055100460000f5d300ffff15ff03ca0000e375d500"],
    ["-linear-stretch", "bad", ""],
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: validates %s %s before replacing the destination`, async (operation, cutoffs, expected) => {
        const files = new Map([["/a.ppm", input], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", keep);
        const argv = ["/a.ppm", operation!, cutoffs!, "-endian", "MSB", "-depth", "8", "rgb:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(result.exitCode).toBe(expected ? 0 : 1);
        expect(output).toEqual(expected ? Uint8Array.from(Buffer.from(expected, "hex")) : keep);
        if (!expected) expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument");
    });
}
