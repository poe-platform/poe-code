import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI; A through L are the input pixels, dots are lime.
const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 3\n255\n"),
    ...Array.from({ length: 36 }, (_, i) => i * 7)]);
const doubled = ["........", "........", "........", "....ABCD", "....EFGH", "....IJKL"];
const paged = [...Array<string>(9).fill(".............."), "..........ABCD", "..........EFGH", "..........IJKL"];
const explicit = ["A....BCD", "........", "........", "........", "E....FGH", "I....JKL"];
const cases = [
    ...["4@+1+1", "1!+1+1", "1^+1+1", "1#+1+1", "1>+1+1", "1<+1+1",
        "4@-1-1", "1+1!+1", "1+1+1!"].flatMap(geometry => [
        { geometry, page: "", rows: doubled, info: "8x6|8x6+0+0" },
        { geometry, page: "10x9+2+1", rows: geometry.includes(">") ? doubled : paged,
            info: geometry.includes(">") ? "8x6|20x18+4+2" : "14x12|35x36+7+3" },
    ]),
    { geometry: "4x3@+1+1", page: "", rows: explicit, info: "8x6|8x6+0+0" },
    { geometry: "4x3@+1+1", page: "10x9+2+1", rows: explicit, info: "8x6|20x18+4+2" },
    { geometry: "4@", page: "", rows: doubled, info: "8x6|8x6+0+0" },
    { geometry: "4@", page: "10x9+2+1", rows: [...Array<string>(9).fill("........"), "....ABCD", "....EFGH", "....IJKL"], info: "8x12|20x36+4+4" },
    { geometry: "1+1+1", page: "", rows: [], info: "" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`matches native scalar splice modifiers (${mode}): $geometry page=$page`, async ({ geometry, page, rows, info }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out", original]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        await fs.writeFile("/out", original);
        const argv = ["/in.ppm", ...(page ? ["-repage", page] : []), "-background", "lime",
            "-splice", geometry, "-depth", "8", "-write", "rgb:/out", "-format", "%wx%h|%g", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(info ? 0 : 1);
        expect("stdout" in result ? result.stdout : stdout).toBe(info);
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        if (info) expect(diagnostic).toBe("");
        else expect(diagnostic).toContain("invalid argument for option '-splice'");
        const expected = info ? Uint8Array.from([...rows.join("")].flatMap(pixel => {
            const value = (pixel.charCodeAt(0) - 65) * 21;
            return pixel === "." ? [0, 255, 0] : [value, value + 7, value + 14];
        })) : original;
        expect(mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out"))
            .toEqual(expected);
    });
}
