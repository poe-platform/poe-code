import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n5 3\n255\n"),
    Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, i * 47 % 256, 200 - i * 7]).flat())
]);

// ImageMagick 7.1.2-35 Q16-HDRI: in.ppm -virtual-pixel METHOD -colorspace CMYK
// -rotational-blur 130 -channel K -separate -depth 8 gray:-.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { virtualPixel: "white", expected: "304c4e553f4a506854567d48404188" },
    { virtualPixel: "gray", expected: "304c4e553f39506854454a48404155" },
    { virtualPixel: "black", expected: "304c4e553f28506854341748404122" },
    { virtualPixel: "edge", expected: "304c4e553f31506854382e48404131" }
])(`${mode}: blurs CMYK black ink with $virtualPixel virtual pixels`, async ({ virtualPixel, expected }) => {
    const argv = ["in.ppm", "-virtual-pixel", virtualPixel, "-colorspace", "CMYK",
        "-rotational-blur", "130", "-channel", "K", "-separate", "-depth", "8", "gray:-"];
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
