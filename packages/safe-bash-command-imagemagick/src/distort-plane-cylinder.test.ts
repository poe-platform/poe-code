import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n255 255 0 0 255 255 255 0 255\n");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI, complete depth-8 RGB output.
    it.each([
        { op: "-distort", method: "Plane2Cylinder", args: "90", filter: "point", geometry: "3x2 3x2+0+0", hex: "b5000000ff000000b5b5b50000ffffb500b5" },
        { op: "-distort", method: "Plane2Cylinder", args: "45", filter: "point", geometry: "3x2 3x2+0+0", hex: "f3000000ff000000f3f3f30000fffff300f3" },
        { op: "+distort", method: "Plane2Cylinder", args: "120", filter: "point", geometry: "2x2 2x2+0+0", hex: "82640000648282e6648264e6" },
        { op: "-distort", method: "Plane2Cylinder", args: "90", filter: "Robidoux", geometry: "3x2 3x2+0+0", hex: "6f1d000dd1270c28876c761229e7c85f289a" },
        { op: "-distort", method: "Plane2Cylinder", args: "45", filter: "Robidoux", geometry: "3x2 3x2+0+0", hex: "d11d0005dc1f1110ced0cd1320f5dabf0fe6" },
        { op: "-distort", method: "AffineProjection", args: "1,0,0,1,1,0", filter: "point", geometry: "3x2 3x2+0+0", hex: "000000ff000000ff00000000ffff0000ffff" },
    ])(`${mode}: $op $method $args with $filter`, async ({ op, method, args, filter, geometry, hex }) => {
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-virtual-pixel", "black", "-filter", filter, op, method, args,
            "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", "rgb:-"];
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.concat([Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : ""), result.stdoutBytes]) : Buffer.concat(chunks);
        expect(Buffer.from(bytes)).toEqual(Buffer.concat([Buffer.from(`${geometry};`), Buffer.from(hex, "hex")]));
    });
}

it.each(["0", "-1", "161", "1e-13", "NaN", ""])("rejects invalid field of view %s without replacing the destination", async args => {
    for (const retained of [false, true]) for (const op of ["-distort", "+distort"]) {
        const original = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
        const files = new Map([["/in.ppm", input], ["/out.png", original]]);
        await fs.writeFile("/in.ppm", input);
        await fs.writeFile("/out.png", original);
        const result = await runMagickCli(["/in.ppm", op, "Plane2Cylinder", args, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(args === "NaN" || args === "" ? "invalid list of numbers" : "Plane2Cylinder : Invalid FOV Angle");
        expect(retained ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    }
});
