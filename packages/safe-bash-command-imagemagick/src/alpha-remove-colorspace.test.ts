import { decodeImage } from "@poe-code/image-ast/portable";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference pixels.
const cases = [
    { space: "Lab", background: "white", hex: "ff553aff" },
    { space: "HSL", background: "white", hex: "c245edff" },
    { space: "YCbCr", background: "white", hex: "e156ffff" },
    { space: "Lab", background: "white", separate: true, hex: "9a" },
    { space: "Lab", background: "black", separate: true, hex: "1b" },
    { space: "HSL", background: "white", separate: true, hex: "ca" },
    { space: "HSL", background: "black", separate: true, hex: "4b" },
    { space: "sRGB", background: "white", hex: "8899aaff" },
    { space: "Lab", background: "white", opaque: true, hex: "123456ff" },
    { space: "Lab", background: "white", png: true, hex: "ff553aff" },
];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${execution}: removes alpha in $space on $background (%j)`, async ({ space, background, separate, opaque, png, hex }) => {
        const argv = [`xc:#123456${opaque ? "ff" : "80"}`, "-colorspace", space,
            "-background", background, "-alpha", "Remove",
            ...(separate ? ["-channel", "R", "-separate"] : ["-colorspace", "sRGB"]),
            "-depth", "8", `${png ? "PNG32" : separate ? "gray" : "rgba"}:${execution === "command" ? "-" : "out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : execution === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = execution === "command" ? Buffer.concat(chunks)
            : execution === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(png ? decodeImage(output).data : output).toString("hex")).toBe(hex);
    });
}
