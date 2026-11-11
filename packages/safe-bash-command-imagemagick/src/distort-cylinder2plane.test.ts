import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n255 255 0 0 255 255 255 0 255\n");
const keep = new TextEncoder().encode("KEEP");

// Geometry and RGB references from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { options: ["-distort", "Cylinder2Plane", "90"], geometry: "3x2 3x2+0+0", hex: "eb210100ff000d14ecebf21300ffffde14fe" },
    { options: ["-distort", "Cylinder2Plane", "45"], geometry: "3x2 3x2+0+0", hex: "f90a0000ff000406f9f9fb0600fffff506ff" },
    { options: ["+distort", "Cylinder2Plane", "90"], geometry: "4x3 4x3+0+0", hex: "850000424500004542000085ba5d007dc1413e82be5d00ba858500428845424588850085" },
    { options: ["+distort", "Cylinder2Plane", "45"], geometry: "4x3 4x3+0+0", hex: "5300004041000041400000539249007fc0403f80bf490092535300408241404182530053" },
    { options: ["-distort", "Cylinder2Plane", "160"], geometry: "3x2 3x2+0+0", hex: "cd4d0700ff001c32d4cde32b00ffffb232f8" },
    { options: ["-distort", "Cylinder2Plane", "90,1,2"], geometry: "3x2 3x2+0+0", hex: "eb210100ff000d14ecebf21300ffffde14fe" },
    { options: ["-repage", "8x7+2+1", "-distort", "Cylinder2Plane", "90"], geometry: "3x2 8x7+0+0", hex: "0feab8368bb52800eb10b4c46275d8de00de" },
    { options: ["-repage", "8x7+2+1", "+distort", "Cylinder2Plane", "90"], geometry: "4x6 11x21+0+0", hex: "0000000000000000000000003c000006060000060600003cba14007d840202827f1400babaa6007dfd807b82fda600ba3c3c00060c0606060c3c003c000000000000000000000000" },
    { options: ["-define", "distort:viewport=4x3-1-1", "-distort", "Cylinder2Plane", "90"], geometry: "4x3 4x3-1-1", hex: "360000280300000000000328741200eb210100ff000d14ec746200ebf21300ffffde14fe" },
    { options: ["-filter", "Robidoux", "-distort", "Cylinder2Plane", "90"], geometry: "3x2 3x2+0+0", hex: "f22d0000e7181715ebf1ef1b18ffe7d915ff" },
    { options: ["-distort", "AffineProjection", "1,0,0,1,1,0"], geometry: "3x2 3x2+0+0", hex: "000000ff000000ff00000000ffff0000ffff" }
];

for (const mode of ["command", "sync"] as const) {
    async function run(options: string[]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input], ["/out.rgb", keep]]);
        await fs.writeFile("/in.ppm", input);
        await fs.writeFile("/out.rgb", keep);
        const args = ["/in.ppm", "-virtual-pixel", "black", "-filter", "point", ...options,
            "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", "/out.rgb"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stdout" in result) stdout += result.stdout;
        if ("stderr" in result) stderr += result.stderr;
        return { exitCode: result.exitCode, stdout, stderr, output: mode === "command" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")! };
    }

    it.each(cases)(`matches native $options (${mode})`, async ({ options, geometry, hex }) => {
        const result = await run(options);
        expect({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }).toEqual({ exitCode: 0, stdout: geometry + ";", stderr: "" });
        expect(Buffer.from(result.output).toString("hex")).toBe(hex);
    });

    it.each(["", "0", "-1", "161", "1e-13"])(`rejects invalid field of view %s without replacing output (${mode})`, async fov => {
        const result = await run(["-distort", "Cylinder2Plane", fov]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(fov === "" ? "invalid list of numbers" : "Invalid FOV Angle");
        expect(result.output).toEqual(keep);
    });
}
