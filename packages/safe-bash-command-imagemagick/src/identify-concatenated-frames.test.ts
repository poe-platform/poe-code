import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// Two concatenated P6 images, red then blue, without a separator.
const ppm = Buffer.from("50360a3120310a3235350aff000050360a3120310a3235350a0000ff", "hex");
const txt = Buffer.from(`# ImageMagick pixel enumeration: 2,1,0,255,srgb
0,0: (255,0,0) #FF0000 red
1,0: (255,0,0) #FF0000 red
# ImageMagick pixel enumeration: 1,1,0,255,srgb
0,0: (0,0,255) #0000FF blue
`);
const format = "%s/%n:%[fx:p{0,0}.r];";

for (const route of ["sync", "map", "sdk", "identify", "magick"] as const) {
    for (const [name, bytes, full] of [
        ["binary PPM", ppm, "0/2:1;1/2:0;"],
        ["TXT", txt, "0/2:1;1/2:0;"],
        ["ASCII PPM", Buffer.from("P3\n1 1\n255\n255 0 0\n\nP3\n1 1\n255\n0 0 255\n"), "0/2:1;1/2:0;"],
        ["mixed Netpbm", Buffer.concat([Buffer.from("P1\n1 1\n0\n"), ppm.subarray(ppm.length / 2)]), "0/2:1;1/2:0;"]
    ] as const) {
        it.each([
            { options: [], input: "/multi.ppm", expected: full },
            { options: ["-ping"], input: "/multi.ppm", expected: "0/2:0;1/2:0;" },
            { options: [], input: "/multi.ppm[1]", expected: "1/1:0;" }
        ])(`enumerates ${name} frames (${route}): $input $options`, async ({ options, input, expected }) => {
            expect(await identify([...options, "-format", format, input], bytes))
                .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        });
    }

    it.each([
        { coder: "PPM", bytes: ppm, width: 1 },
        { coder: "TXT", bytes: txt, width: 2 }
    ])(`describes every concatenated $coder frame (${route})`, async ({ coder, bytes, width }) => {
        const result = await identify(["/multi.ppm"], bytes);
        expect(result).toEqual({ exitCode: 0, stderr: "", stdout:
            `/multi.ppm[0] ${coder} ${width}x1 ${width}x1+0+0 8-bit sRGB ${bytes.length}B 0.000u 0:00.000\n` +
            `/multi.ppm[1] ${coder} 1x1 1x1+0+0 8-bit sRGB ${bytes.length}B 0.000u 0:00.000\n` });
    });

    it(`formats each TXT frame's dimensions (${route})`, async () => {
        expect(await identify(["-format", "%s/%n:%wx%h;", "/multi.ppm"], txt))
            .toEqual({ exitCode: 0, stdout: "0/2:2x1;1/2:1x1;", stderr: "" });
    });

    it(`restarts the scene list for repeated PPM inputs (${route})`, async () => {
        expect(await identify(["-format", format, "/multi.ppm", "/multi.ppm"]))
            .toEqual({ exitCode: 0, stdout: "0/2:1;1/2:0;0/2:1;1/2:0;", stderr: "" });
    });

    async function identify(args: string[], bytes: Uint8Array = ppm) {
        const files = new Map([["/multi.ppm", bytes]]);
        if (route === "sync") return runIdentifyCliSync(args, files);
        if (route === "map") return runIdentifyCli(args, files);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/multi.ppm", bytes);
        if (route === "sdk") return runIdentifyCli(args, { filesystem, cwd: "/" });
        const command = route === "magick" ? createMagickCommand() : createIdentifyCommand();
        const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
        let stdout = "", stderr = "";
        const result = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        return { ...result, stdout, stderr };
    }
}
