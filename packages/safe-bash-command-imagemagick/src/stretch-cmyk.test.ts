import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode(`P3
4 2
255
19 61 200 91 125 39 120 85 65 198 183 17
213 210 98 220 90 179 67 85 190 141 184 70
`);
const separateBlack = ["+channel", "-channel", "K", "-separate"];
// ImageMagick 7.1.2-35 Q16-HDRI, followed by -endian MSB -depth 8 rgb:out.
const cases = [
    { operations: ["-contrast-stretch", "1x1", "-colorspace", "sRGB"], expected: "0000b8080d00020100b4b400d6d600e600b60000a2659400" },
    { operations: ["-linear-stretch", "1x1", "-colorspace", "sRGB"], expected: "0000bd2f4800402817bab200d1d131dc22ad0b25ad74a412" },
    { operations: separateBlack, expected: "3737378282828787873939392a2a2a232323414141474747" },
    { operations: ["-contrast-stretch", "1x1", ...separateBlack], expected: "474747f2f2f2fdfdfd4b4b4b2929291919195d5d5d6b6b6b" },
    { operations: ["-channel", "K", "-linear-stretch", "1x1", ...separateBlack], expected: "424242b7b7b7bfbfbf4545452e2e2e2323235252525b5b5b" },
    { operations: ["-channel", "C", "-linear-stretch", "1x1", ...separateBlack], expected: "3737378282828787873939392a2a2a232323414141474747" },
    { operations: ["-colorspace", "sRGB"], expected: "133dc85b7d27785541c6b711d5d262dc5ab34355be8db846" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: stretches CMYK ink planes for $operations`, async ({ operations, expected }) => {
        const files = new Map<string, Uint8Array>([["/a.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/a.ppm", "-colorspace", "CMYK", ...operations, "-endian", "MSB", "-depth", "8", "rgb:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
