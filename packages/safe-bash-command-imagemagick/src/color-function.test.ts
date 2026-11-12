import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the same components have distinct source
// colorspaces, while TintImage uses the fill's unconverted components.
const colors = [
    { name: "srgb", hex: "b33380ff", info: "sRGB srgb(70%,20%,50%)" },
    { name: "display-p3", hex: "c22282ff", info: "DisplayP3 displayp3(70%,20%,50%)" },
    { name: "xyz", hex: "ff00e8ff", info: "XYZ xyz(70,20,50)" },
];
const cases = [
    ...colors.flatMap(({ name, hex, info }) => [
        { name: `${name} source`, args: [`xc:color(${name} 0.7 0.2 0.5)`, "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex },
        { name: `${name} metadata`, args: [`xc:color(${name} 0.7 0.2 0.5)`, "-format", "%[colorspace] %[pixel:p{0,0}]", "info:/out"], text: info },
        { name: `${name} fill`, args: ["xc:#345ca980", "-fill", `color(${name} 0.7 0.2 0.5)`, "-tint", "60", "-depth", "8", "rgba:/out"], hex: "432ba380" },
        { name: `${name} alpha`, args: [`canvas:color(${name} 0.7 0.2 0.5 / 0.5)`, "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: hex.slice(0, 6) + "80" },
    ]),
    { name: "mixed case and whitespace", args: ["xc:COLOR(Display-P3\t0.7  0.2\n0.5)", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "c22282ff" },
    { name: "DisplayP3 alias", args: ["xc:color(displayp3 0.7 0.2 0.5)", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "c22282ff" },
    { name: "explicit opaque alpha", args: ["xc:color(srgb 0.7 0.2 0.5 / 1)", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "srgba(70%,20%,50%,1)" },
    { name: "comma components", args: ["xc:color(srgb 0.7,0.2,0.5)", "-depth", "8", "rgba:/out"], hex: "b33380ff" },
    { name: "native percent scaling", args: ["xc:color(display-p3 70% 20% 50%)", "-format", "%[colorspace] %[pixel:p{0,0}]", "info:/out"], text: "DisplayP3 displayp3(17850%,5100%,12750%)" },
    { name: "hex control", args: ["xc:#7f6daa", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "7f6daaff" },
    ...["bogus", "srgb-linear"].flatMap(space => [
        { name: `unknown ${space} source`, args: [`xc:color(${space} 0.7 0.2 0.5)`, "rgba:/out"], error: true },
        { name: `unknown ${space} fill`, args: ["xc:#345ca980", "-fill", `color(${space} 0.7 0.2 0.5)`, "-tint", "60", "rgba:/out"], error: true },
    ]),
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async test => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const sentinel = new Uint8Array([1, 2, 3]);
        files.set("/out", sentinel);
        await fs.writeFile("/out", sentinel);
        const args = createCommandArguments(test.args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(test.args, files)
            : await runConvertCli(test.args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if ("error" in test) {
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain("Unable to parse color from string:");
            expect(output).toEqual(sentinel);
        } else {
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            if ("text" in test) expect(new TextDecoder().decode(output)).toBe(test.text);
            else expect(Buffer.from(output).toString("hex")).toBe(test.hex);
        }
    });
}
