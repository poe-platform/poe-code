import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#34a05c80 -colorspace CMYK
// [-channel selection] -equalize +channel [-colorspace sRGB] -depth 8 cmyka:- / rgba:-
const cases = [
    { channel: "", cmyka: "ff00ffffff", rgba: "000000ff" },
    { channel: "Default", cmyka: "ff00ffffff", rgba: "000000ff" },
    { channel: "All", cmyka: "ff00ffffff", rgba: "000000ff" },
    { channel: "C", cmyka: "ff006c5f80", rgba: "00a05c80" },
    { channel: "M", cmyka: "ac006c5f80", rgba: "34a05c80" },
    { channel: "Y", cmyka: "ac00ff5f80", rgba: "34a00080" },
    { channel: "K", cmyka: "ac006cff80", rgba: "00000080" },
    { channel: "A", cmyka: "ac006c5fff", rgba: "34a05cff" },
    { channel: "CMYK", cmyka: "ff00ffff80", rgba: "00000080" },
    { channel: "CMYK,Sync", cmyka: "ff00ffff80", rgba: "00000080" },
];

for (const { source, depth, cases: references } of [
    { source: ["xc:#34a05c80"], depth: "8", cases },
    { source: ["xc:#34a05c80", "xc:#a0345c40", "xc:#002080c0", "+append"], depth: "16", cases: [
        { channel: "", cmyka: "aaaa00005555555555550000aaaa555555555555ffffffff00005555ffff", rgba: "38e3aaaa71c75555aaaa38e371c7555500000000aaaaffff" },
        { channel: "Default", cmyka: "aaaa00005555555555550000aaaa555555555555ffffffff00005555ffff", rgba: "38e3aaaa71c75555aaaa38e371c7555500000000aaaaffff" },
        { channel: "All", cmyka: "80000000ffffaaaaaaaa00008000ffffaaaa5555ffffffff0000ffffffff", rgba: "2aab55550000aaaa55552aab00005555000000000000ffff" },
        { channel: "C", cmyka: "800000006ccc5f5f80800000accc6ccc5f5f4040ffffbfff00007f7fc0c0", rgba: "5050a0a05c5c8080a0a034345c5c4040000020208080c0c0" },
        { channel: "M", cmyka: "accc00006ccc5f5f8080000080006ccc5f5f4040ffffffff00007f7fc0c0", rgba: "3434a0a05c5c8080a0a050505c5c4040000000008080c0c0" },
        { channel: "Y", cmyka: "accc0000ffff5f5f80800000acccffff5f5f4040ffffbfff00007f7fc0c0", rgba: "3434a0a000008080a0a0343400004040000020208080c0c0" },
        { channel: "K", cmyka: "accc00006cccaaaa80800000accc6cccaaaa4040ffffbfff0000ffffc0c0", rgba: "1bbc55553111808055551bbc31114040000000000000c0c0" },
        { channel: "A", cmyka: "accc00006ccc5f5faaaa0000accc6ccc5f5f5555ffffbfff00007f7fffff", rgba: "3434a0a05c5caaaaa0a034345c5c5555000020208080ffff" },
        { channel: "CMYK", cmyka: "80000000ffffaaaa808000008000ffffaaaa4040ffffffff0000ffffc0c0", rgba: "2aab55550000808055552aab00004040000000000000c0c0" },
        { channel: "CMYK,Sync", cmyka: "aaaa00005555555580800000aaaa555555554040ffffffff00005555c0c0", rgba: "38e3aaaa71c78080aaaa38e371c7404000000000aaaac0c0" },
    ] },
]) for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["cmyka", "rgba"] as const) {
        it.each(references)(`${mode} Q${depth}: equalizes CMYK $channel and exports ${format}`, async ({ channel, ...expected }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const argv = [...source, "-colorspace", "CMYK",
                ...(channel ? ["-channel", channel] : []), "-equalize", "+channel",
                ...(format === "rgba" ? ["-colorspace", "sRGB"] : []), "-depth", depth, "-endian", "MSB", `${format}:/out`];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected[format]);
        });
    }
}
