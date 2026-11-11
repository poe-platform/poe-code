import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);

// ImageMagick 7.1.2-35 Q16-HDRI keeps palette indices even when masked RGB
// samples differ from their edited colormap entries.
const cases: { options: string[]; expected: string; output?: "info" }[] = [
    { options: ["-region", "1x1+1+0", "-solarize", "0", "+region", "-cycle", "1"], expected: "a5917dfff5ebe1ff" },
    { options: ["-write-mask", "/in.ppm", "-solarize", "0", "+write-mask", "-cycle", "1"], expected: "a5917dfff5ebe1ff" },
    { options: ["-region", "1x1+1+0", "-negate", "+region", "-cycle", "1"], expected: "a5917dfff5ebe1ff" },
    { options: ["-write-mask", "/in.ppm", "-negate", "+write-mask", "-cycle", "1"], expected: "a5917dfff5ebe1ff" },
    { options: ["-region", "1x1+1+0", "-solarize", "0", "+region"], expected: "0a141effa5917dff" },
    { options: ["-solarize", "0", "-cycle", "1"], expected: "a5917dfff5ebe1ff" },
    { options: ["-negate", "-cycle", "1"], expected: "a5917dfff5ebe1ff" },
    { options: ["-region", "1x1+1+0", "-solarize", "100%", "+region", "-cycle", "1"], expected: "5a6e82ff0a141eff" },
    { options: ["-write-mask", "/in.ppm", "-solarize", "100%", "+write-mask", "-cycle", "1"], expected: "5a6e82ff0a141eff" },
    { options: ["-cycle", "1"], expected: "5a6e82ff0a141eff" },
    { options: ["-region", "1x1+1+0", "+negate", "+region", "-cycle", "1"], expected: "5a6e82ff0a141eff" },
    { options: ["-region", "1x1+1+0", "-solarize", "0", "+region"], output: "info", expected: "PseudoClass sRGB |2" },
    { options: ["-write-mask", "/in.ppm", "-negate", "+write-mask"], output: "info", expected: "PseudoClass sRGB |2" },
    ...["Riemersma", "FloydSteinberg"].map(method => ({
        options: ["-dither", method, "-colors", "1", "-region", "1x1+1+0", "-negate", "+region", "-cycle", "1"], expected: "cdbeafffcdbeafff"
    }))
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: quantized palette after $options`, async ({ options, expected, output }) => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-colors", "2", ...options, ...(output === "info" ? ["-format", "%r|%k", "info:/out"] : ["-depth", "8", "rgba:/out"])];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(actual).toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
