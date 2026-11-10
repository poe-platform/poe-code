import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode(`P3
4 2
255
19 61 200 91 125 39 120 85 65 198 183 17
213 210 98 220 90 179 67 85 190 141 184 70
`);
// ImageMagick 7.1.2-35 Q16-HDRI: a.ppm -contrast-stretch 1x1 <output arguments>.
const cases = [
    {
        name: "default PNG",
        output: ["png:/out"],
        expected: Buffer.from("0000ff076c005d0000ffff00ffff1cff04ff0000ff9cff00", "hex"),
    },
    {
        name: "16-bit RGB",
        output: ["-endian", "MSB", "-depth", "16", "rgb:/out"],
        expected: Buffer.from("00000000ffff06bd6c9700005d9d00000000ffffffff0000ffffffff1bb5ffff03beffff00000000ffff9c85ffff0000", "hex"),
    },
    {
        name: "red mean",
        output: ["-format", "%[fx:mean.r]", "info:/out"],
        expected: Buffer.from("0.500427"),
    },
    {
        name: "8-bit RGB",
        output: ["-endian", "MSB", "-depth", "8", "rgb:/out"],
        expected: Buffer.from("0000ff076c005d0000ffff00ffff1cff04ff0000ff9cff00", "hex"),
    },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves fractional stretch values in $name`, async ({ name, output, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", keep);
        const argv = ["/a.ppm", "-contrast-stretch", "1x1", ...output];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (name === "default PNG") {
            const image = decodeImage(bytes);
            expect(image.format).toBe("png");
            expect(image.data16).toBeUndefined();
            expect(image.data.filter((_, index) => index % 4 !== 3)).toEqual(Uint8Array.from(expected));
        } else expect(bytes).toEqual(Uint8Array.from(expected));
    });
}
