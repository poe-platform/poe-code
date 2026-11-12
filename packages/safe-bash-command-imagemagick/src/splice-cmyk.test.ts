import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 destination bytes.
const cases = [
    { name: "converted CMYK", input: "in.ppm", convert: true, background: "#402080", hash: "4b277f9b05214f5182e2f45c7a506ee3768ad121ca16e669a8493e9613e232b9" },
    { name: "PAM inks", input: "ink.pam", convert: false, background: "#402080", hash: "418920339c9209f0ca947d3792145490e6ade1e4a783af0772bb554150e39ff7" },
    { name: "white CMYK control", input: "in.ppm", convert: true, background: "white", hash: "54359b4b5ca1a41575059c0e7f920fb80d133993e8a4c578a65719634ea0ca8c" },
    { name: "sRGB control", input: "in.ppm", convert: false, background: "#402080", hash: "886e44a9c5600dead4986cdd470b4435a1834f1f63aa3a28c91142228b089041" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: splice matches native $name`, async ({ input, convert, background, hash }) => {
        const files = new Map<string, Uint8Array>([
            ["/in.ppm", Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (i * 53 + 9) % 256))])],
            ["/ink.pam", Buffer.concat([Buffer.from("P7\nWIDTH 4\nHEIGHT 3\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"), Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 53 + 9) % 256))])],
            ["/out", Buffer.from("KEEP")],
        ]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = [`/${input}`, ...(convert ? ["-colorspace", "CMYK"] : []), "-background", background,
            "-splice", "1x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
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
        expect(output).toHaveLength(80);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}

// Native Q16-HDRI PixelInfo gamma retains fractional black in bright fills.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { background: "red", output: ["-channel", "K", "-separate", "+channel", "-evaluate", "multiply", "100000000", "-depth", "8", "gray:/out"], expected: "001d" },
        { background: "white", output: ["-channel", "K", "-separate", "+channel", "-evaluate", "multiply", "100000000", "-depth", "8", "gray:/out"], expected: "001d" },
        { background: "black", output: ["-channel", "K", "-separate", "+channel", "-evaluate", "multiply", "100000000", "-depth", "8", "gray:/out"], expected: "00ff" },
        { background: "red", source: "#123456", output: ["-format", "%[pixel:p{0,0}]|%[pixel:p{1,0}]", "info:/out"], expected: "cmyk(201.628,100.814,0,169)|cmyk(0,255,255,2.92481e-07)", text: true },
    ])(`${mode}: preserves fractional splice black with $background ($text)`, async ({ background, source = "red", output, expected, text }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = [`xc:${source}`, "-colorspace", "CMYK", "-background", background, "-splice", "1x0+1+0", ...output];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(text ? "utf8" : "hex")).toBe(expected);
    });
}
