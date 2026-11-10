import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("4080c0207020906020607040", "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 output.
const cases: { name: string; space: string; channel?: string; before?: string[]; output: string[]; expected: string; depth?: string; repeats?: number }[] = [
    { name: "black separation", space: "CMYK", channel: "K", output: ["-channel", "K", "-separate"], expected: "000000ff999999ffffffffff" },
    { name: "black ink", space: "CMYK", channel: "K", output: ["-colorspace", "sRGB"], expected: "55aaff204f17666000000040" },
    { name: "cyan ink", space: "CMYK", channel: "R", output: ["-colorspace", "sRGB"], expected: "1380c0209020906000607040" },
    { name: "shared ink and alpha range", space: "CMYK", output: ["-colorspace", "sRGB"], expected: "1963ae295000707b063a4752" },
    { name: "sRGB red control", space: "sRGB", channel: "R", output: ["-colorspace", "sRGB"], expected: "6680c020ff20906000607040" },
    { name: "black at 16 bits", space: "CMYK", channel: "K", output: ["-colorspace", "sRGB"], depth: "16", expected: "5555aaaaffff20204fa516c1666660600000000000004040" },
    { name: "cyan at 16 bits", space: "CMYK", channel: "R", output: ["-colorspace", "sRGB"], depth: "16", expected: "12a78080c0c0202090902020909060600000606070704040" },
    { name: "alpha independently of black", space: "CMYK", channel: "A", output: ["-colorspace", "sRGB"], depth: "16", expected: "40408080c0c00000707020209090ffff2020606070708000" },
    { name: "all inks preserving alpha", space: "CMYK", channel: "CMYK", output: ["-colorspace", "sRGB"], depth: "16", expected: "18c6b333ffff202066660000666660600000000000004040" },
    { name: "all inks and alpha independently", space: "CMYK", channel: "All", output: ["-colorspace", "sRGB"], depth: "16", expected: "18c6b333ffff0000666600006666ffff0000000000008000" },
    { name: "shared range at 16 bits", space: "CMYK", output: ["-colorspace", "sRGB"], depth: "16", expected: "18f463d1aeae294e5084000070b97be905d53a4d476c529b" },
    { name: "opaque inks", space: "CMYK", before: ["-alpha", "off"], output: ["-colorspace", "sRGB"], depth: "16", expected: "18f463d1aeaeffff5084000070b9ffff05d53a4d476cffff" },
    { name: "black within a region", space: "CMYK", channel: "K", before: ["-region", "2x1+1+0"], output: ["+region", "-colorspace", "sRGB"], depth: "16", expected: "54b6a96bfe2120204fa516c1666660600000000000004040" },
    { name: "black across retained chunks", space: "CMYK", channel: "K", output: ["-colorspace", "sRGB"], depth: "16", repeats: 200, expected: "5555aaaaffff20204fa516c1666660600000000000004040" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: auto-level uses $name`, async ({ space, channel, before = [], output, expected, depth = "8", repeats = 1 }) => {
        const source = repeats === 1 ? input : Buffer.concat([
            Buffer.from(`P7\nWIDTH 3\nHEIGHT ${repeats}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`),
            Buffer.from("4080c0207020906020607040".repeat(repeats), "hex"),
        ]);
        const files = new Map([["/in.pam", source], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.pam", "-colorspace", space, ...(channel ? ["-channel", channel] : []), ...before, "-auto-level", "+channel", ...output, "-depth", depth, "-endian", "MSB", "rgba:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected.repeat(repeats));
    });
}
