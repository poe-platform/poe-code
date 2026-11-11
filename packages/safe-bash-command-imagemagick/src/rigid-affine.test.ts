import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n255 255 0 0 255 255 255 0 255\n");
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "sync"] as const) {
    async function run(method: string, points: string, output = "rgb:-") {
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input], ["/out.ppm", keep]]);
        await fs.writeFile("/in.ppm", input);
        await fs.writeFile("/out.ppm", keep);
        const args = ["/in.ppm", "-virtual-pixel", "black", "-filter", "point", "-distort", method, points, "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", output];
        let stderr = "";
        const chunks: Uint8Array[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        if ("stdout" in result && typeof result.stdout === "string") chunks.push(Buffer.from(result.stdout));
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) chunks.push(result.stdoutBytes);
        return { exitCode: result.exitCode, stderr, stdout: Buffer.concat(chunks), output: mode === "command" ? await fs.readFile("/out.ppm") : files.get("/out.ppm")! };
    }

    // Native ImageMagick Q16-HDRI references, with the six labeled pixels above.
    it.each([
        ["RigidAffine", "0,0 2,0 1,0 2,1", "ffff00ff000000000000ffff00ff00000000"],
        ["RigidAffine", "0,0 1,0 2,1 3,1", "000000ff000000ff00000000ffff0000ffff"],
        ["RigidAffine", "0,0 0,0 1,0 2,0", "8f00008f3000308f00bf3000bf701040cf30"],
        ["AffineProjection", "1,0,0,1,1,0", "000000ff000000ff00000000ffff0000ffff"],
        ["RigidAffine", "0,0 1,0 2,1 3,1 1,0 2,0", "000000ff000000ff00000000ffff0000ffff"]
    ])(`matches native %s %s (${mode})`, async (method, points, hex) => {
        const result = await run(method!, points!);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toEqual(Buffer.concat([Buffer.from("3x2 3x2+0+0;"), Buffer.from(hex!, "hex")]));
    });

    it.each([
        ["0,0 0", "at least 2"],
        ["0,0 1,0 2,1", "at least 2"],
        ["0,0 1,0", "at least 2"],
        ["0,0 0,0 0,0 1,1", "Unsolvable Matrix"],
        ["0,0 NaN,0 1,0 1,0", "invalid list of numbers"]
    ])(`rejects invalid pairs %s and preserves output (${mode})`, async (points, diagnostic) => {
        const result = await run("RigidAffine", points!, "/out.ppm");
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(diagnostic);
        expect(result.output).toEqual(keep);
    });
}
