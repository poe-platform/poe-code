import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a.ppm -linear-stretch 1x1 <output options>.
const input = new TextEncoder().encode(`P3
4 2
255
19 61 200 91 125 39 120 85 65 198 183 17
213 210 98 220 90 179 67 85 190 141 184 70
`);
const cases = [
    {
        name: "16-bit RGB",
        output: ["-endian", "MSB", "-depth", "16", "rgb:/out"],
        expected: Buffer.from("00000000fb5834ac72a50000698829bd0549f7b3dc5c0000ffffffff416effff32dad51108ee29bde91e8fcede2e0e66", "hex"),
    },
    {
        name: "red mean",
        output: ["-format", "%[fx:mean.r]", "info:/out"],
        expected: Buffer.from("0.522776"),
    },
    {
        name: "8-bit RGB",
        output: ["-endian", "MSB", "-depth", "8", "rgb:/out"],
        expected: Buffer.from("0000fa347200692a05f7dc00ffff41ff33d4092ae88fdd0e", "hex"),
    },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves fractional linear stretch values in $name`, async ({ output, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", keep);
        const argv = ["/a.ppm", "-linear-stretch", "1x1", ...output];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const actual = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(actual).toEqual(new Uint8Array(expected));
    });
}
