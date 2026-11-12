import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI; raw output is hexadecimal.
const cases = [
    { args: ["xc:lab(50,20,-30)", "-format", "%[colorspace] %[pixel:p{0,0}]"], format: "info", text: "CIELab cielab(50,20.0019,-29.9981)" },
    { args: ["canvas:CIELab(50,20,-30)", "-format", "%[colorspace] %[pixel:p{0,0}]"], format: "info", text: "CIELab cielab(50,20.0019,-29.9981)" },
    ...[
        { channel: "R", hex: "80" },
        { channel: "G", hex: "94" },
        { channel: "B", hex: "62" },
    ].map(({ channel, hex }) => ({ args: ["xc:lab(50,20,-30)", "-channel", channel, "-separate", "-depth", "8"], format: "gray", hex })),
    { args: ["xc:lab(50,20,-30)", "-colorspace", "sRGB", "-depth", "8"], format: "rgba", hex: "7f6daaff" },
    { args: ["-size", "4097x1", "xc:lab(50,20,-30)", "-channel", "G", "-separate", "-depth", "8"], format: "gray", hex: "94".repeat(4097) },
    { args: ["xc:hsl(20,50%,30%)", "-format", "%[colorspace] %[pixel:p{0,0}]"], format: "info", text: "sRGB srgb(45%,25%,15%)" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`retains native Lab canvas samples (${mode}): $args`, async ({ args, format, ...expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const output: number[] = [];
        let stderr = "";
        const argv = [...args, `${format}:${mode === "command" ? "-" : "/out"}`];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { output.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" ? output : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("text" in expected ? "utf8" : "hex")).toBe("text" in expected ? expected.text : expected.hex);
    });
}
