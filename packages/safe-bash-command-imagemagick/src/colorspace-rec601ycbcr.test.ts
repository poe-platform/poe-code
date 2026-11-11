import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references. Rec601YCbCr uses lookup
// rounding and a 32768 chroma offset, unlike the generic YCbCr transform.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "red", components: "0.298839 0.331271 1", hex: "fff400000000ffff" },
        { color: "#0080ff", components: "0.408906 0.833726 0.208531", hex: "00128091ffffffff" },
        { color: "lime", components: "0.586811 0.168744 0.0813196", hex: "0000fff20000ffff" },
        { color: "blue", components: "0.11435 1 0.418696", hex: "00170017ffffffff" },
        { color: "black", components: "0 0.500008 0.500008", hex: "000100000001ffff" },
        { color: "white", components: "1 0.500007 0.500008", hex: "fffffffeffffffff" },
        { color: "#20406080", components: "0.227829 0.583927 0.427059", hex: "2025404460668080" },
    ])(`${mode}: converts $color to Rec601YCbCr and back`, async ({ color, components, hex }) => {
        for (const roundTrip of [false, true]) {
            const args = [`xc:${color}`, "-colorspace", "rEc601yCbCr", "-colorspace", "Rec601YCbCr",
                ...(roundTrip ? ["-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out.rgba"]
                    : ["-format", "%[colorspace] %[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:"])];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
                stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            expect(stdout).toBe(roundTrip ? "" : `Rec601YCbCr ${components}`);
            if (roundTrip) {
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("/out.rgba")!;
                expect(Buffer.from(bytes).toString("hex")).toBe(hex);
            }
        }
    });
}

for (const retained of [false, true]) {
    it.each(["info:", "txt:-", "histogram:info:-"])(`formats Rec601YCbCr pixels in %s, retained=${retained}`, async output => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        const result = await runConvertCli(["xc:red", "-colorspace", "Rec601YCbCr", "-format", "%[pixel:p{0,0}]", ...(output === "histogram:info:-" ? ["-format", "%c"] : []), output], input);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain("rec601ycbcr(76.2039,84.4741,255)");
    });
}

for (const retained of [false, true]) {
    it.each([
        { args: ["xc:#0080ff", "-evaluate", "Multiply", "0.12345", "-colorspace", "Rec601YCbCr"], hex: "00030fde1f9dffff" },
        { args: ["xc:#0080ff", "-evaluate", "Add", "25%", "-colorspace", "Rec601YCbCr"], hex: "400bc08bffffffff" },
        { args: ["xc:#4080c0", "-set", "colorspace", "Rec601YCbCr"], hex: "9b0811d64124ffff" },
        { args: ["xc:#0080ff", "-colorspace", "YCbCr"], hex: "00118091ffffffff" },
    ])(`uses native lookup rounding and keeps generic YCbCr distinct: $args, retained=${retained}`, async ({ args, hex }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const result = await runConvertCli([...args, "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out.rgba"],
            retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(Buffer.from(retained ? await fs.readFile("/out.rgba") : files.get("/out.rgba")!).toString("hex")).toBe(hex);
    });
}
