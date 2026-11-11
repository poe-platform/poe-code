import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from("aa3355000042e500876543ffaa335501aa335580876543ff0042e500aa3355ff", "hex")]);
// Native ImageMagick 7.1.2-35 Q16-HDRI; indentation is not part of these assertions.
const multiplied = [
    "2: (0,0.066,0.229,0) #00000000 srgba(0%,0.0258824%,0.0898039%,0)",
    "2: (0.135,0.101,0.067,255) #000000FF srgba(0.0529412%,0.0396078%,0.0262745%,1)",
    ...[[0, "00", "0"], [1, "01", "0.00392157"], [128, "80", "0.501961"], [255, "FF", "1"]].map(([a, hex, alpha]) => `1: (0.17,0.051,0.085,${a}) #000000${hex} srgba(0.0666667%,0.02%,0.0333333%,${alpha})`)
];
const added = [
    "2: (255.004,321.004,484.004,0) #FFFFFF00 srgba(100.002%,125.884%,189.805%,0)",
    "2: (390.004,356.004,322.004,255) #FFFFFFFF srgba(152.943%,139.609%,126.276%,1)",
    ...[[0, "00", "0"], [1, "01", "0.00392157"], [128, "80", "0.501961"], [255, "FF", "1"]].map(([a, hex, alpha]) => `1: (425.004,306.004,340.004,${a}) #FFFFFF${hex} srgba(166.668%,120.002%,133.335%,${alpha})`)
];
const original = [
    "2: (0,66,229,0) #0042E500 srgba(0,66,229,0)",
    "2: (135,101,67,255) #876543FF srgba(135,101,67,1)",
    ...[[0, "00", "0"], [1, "01", "0.00392157"], [128, "80", "0.501961"], [255, "FF", "1"]].map(([a, hex, alpha]) => `1: (170,51,85,${a}) #AA3355${hex} srgba(170,51,85,${alpha})`)
];
const clamped = [[3, 0, "00", "0"], [3, 255, "FF", "1"], [1, 1, "01", "0.00392157"], [1, 128, "80", "0.501961"]].map(([n, a, hex, alpha]) => `${n}: (255,255,255,${a}) #FFFFFF${hex} ${a === 255 ? "white" : `srgba(255,255,255,${alpha})`}`);
for (const mode of ["command", "sync"] as const) {
    it.each([
        { name: "fractional", operations: ["-evaluate", "multiply", "0.001"], expected: multiplied },
        { name: "above white", operations: ["-evaluate", "add", "100%"], expected: added },
        { name: "unchanged", operations: [], expected: original },
        { name: "clamped", operations: ["-evaluate", "add", "100%", "-clamp"], expected: clamped }
    ])(`keeps native histogram bins for $name samples (${mode})`, async ({ operations, expected }) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", input);
        const argv = ["/in.pam", "-channel", "RGB", ...operations, "+channel", "-format", "%c", "histogram:info:/out"];
        const files = new Map([["/in.pam", input as Uint8Array]]);
        const argumentValues = createCommandArguments(argv);
        const result = mode === "sync" ? runConvertCliSync(argv, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        });
        expect(result.exitCode).toBe(0);
        const output = new TextDecoder().decode(mode === "sync" ? files.get("/out")! : await fs.readFile("/out"));
        expect(output.trim().split("\n").map(line => line.trim())).toEqual(expected);
    });
}

it.each([0.001, -0.001])("counts and sorts distinct samples beyond the storage cache (%s)", async multiplier => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pam", Buffer.concat([
        Buffer.from("P7\nWIDTH 256\nHEIGHT 1\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n"),
        Uint8Array.from(Array.from({ length: 256 }, (_, r) => [r, 0, 0]).flat())
    ]));
    const argumentValues = createCommandArguments(["/in.pam", "-evaluate", "multiply", String(multiplier), "-format", "%c", "histogram:info:/out"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    const lines = new TextDecoder().decode(await fs.readFile("/out")).trim().split("\n").map(line => line.trim());
    expect(lines).toHaveLength(256);
    for (const [index, line] of lines.entries()) {
        expect(line.startsWith("1: (")).toBe(true);
        const samples = line.slice(line.indexOf("(") + 1, line.indexOf(")")).split(",").map(Number);
        expect(samples).toHaveLength(3);
        expect(samples[0]).toBeCloseTo((multiplier < 0 ? 255 - index : index) * multiplier, 6);
        expect(samples.slice(1)).toEqual([0, 0]);
    }
});
