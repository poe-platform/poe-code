import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n5 3\n255\n"),
    Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, i * 47 % 256, 200 - i * 7]).flat())
]);

// ImageMagick 7.1.2-35 Q16-HDRI: in.ppm -virtual-pixel METHOD -colorspace CMYK
// -motion-blur 2x1+0 -channel K -separate -depth 8 gray:-.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { virtualPixel: "white", expected: "3b4248589436646a73a0333b2c2f77" },
    { virtualPixel: "gray", expected: "3b42484d5d3664696869333b2b2440" },
    { virtualPixel: "black", expected: "3b424743263664695e32333b2a190a" },
    { virtualPixel: "edge", expected: "3b424748433664696558333b2a1b11" }
])(`${mode}: blurs CMYK black ink with $virtualPixel virtual pixels`, async ({ virtualPixel, expected }) => {
    const argv = ["in.ppm", "-virtual-pixel", virtualPixel, "-colorspace", "CMYK",
        "-motion-blur", "2x1+0", "-channel", "K", "-separate", "-depth", "8", "gray:-"];
    const fs = new MemoryFileSystem(), output: Uint8Array[] = [];
    await fs.writeFile("/in.ppm", input);
    const files = new Map([["in.ppm", input]]);
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(output) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(bytes.toString("hex")).toBe(expected);
});
