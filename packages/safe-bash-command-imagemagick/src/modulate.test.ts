import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31: magick -size 1x1 xc:COLOR
// -modulate VALUE -depth 8 rgba:-. Alpha must remain unchanged.
const values = ["50", "150", "100,50", "100,150", "100,100,50", "100,100,150", "100,100,300"];
const samples = [
    { color: "#ff0000", alpha: 255, rgb: [[128,0,0], [255,128,128], [191,64,64], [255,0,0], [128,0,255], [128,255,0], [255,0,0]] },
    { color: "#0000ff", alpha: 255, rgb: [[0,0,128], [128,128,255], [64,64,191], [0,0,255], [0,255,128], [255,0,128], [0,0,255]] },
    { color: "#80402080", alpha: 128, rgb: [[64,32,16], [192,96,48], [104,72,56], [152,56,8], [112,32,128], [48,128,32], [128,64,32]] },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const { color, alpha, rgb } of samples) {
        it.each(values)(`matches native modulation of ${color} by %s via ${mode}`, async value => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", `xc:${color}`, "-modulate", value, "out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual([...rgb[values.indexOf(value)]!, alpha]);
        });
    }
}

for (const mode of ["buffered", "command", "sync"] as const) {
    // Native ImageMagick 7.1.2 Q16-HDRI RGBA bytes for xc:#1964dc.
    it.each([
        ["80,60,120", [71, 51, 145]],
        ["80x60+120", [71, 51, 145]],
        ["80%,60%,120%", [71, 51, 145]],
        ["80%", [20, 80, 176]],
        ["80x60", [51, 87, 145]],
        ["80x60%", [51, 87, 145]],
        ["80x60+0", [145, 109, 51]],
        ["80x60-120", [51, 143, 145]],
    ] as const)(`parses native modulation %s via ${mode}`, async (value, rgb) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#1964dc", "-modulate", value, "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([...rgb, 255]);
    });
}

for (const mode of ["buffered", "retained", "command", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI: omitted hue defaults to 100; explicit zero rotates it.
    it.each([
        ["120,75,", "5f95ce80"],
        ["120x75+", "5f95ce80"],
        ["120,,", "4d95e080"],
        ["120,75", "5f95ce80"],
        ["120,75,100", "5f95ce80"],
        ["120,75,0", "ce985f80"],
    ] as const)(`defaults omitted modulation hue in %s via ${mode}`, async (value, expected) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/dest", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/dest", original);
        const args = ["xc:#257bd680", "-modulate", value, "-depth", "8", "rgba:/dest"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/dest") : files.get("/dest")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
