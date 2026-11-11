import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n255 255 0  0 255 255  255 0 255\n");

for (const retained of [false, true]) {
    it.each([
        ["Shepards", "0,0 1,0  2,1 2,1", "4900008080000049b680800049ffb6d12eff"],
        ["Shepards", "0,0 1,0", "000000ff000000ff00000000ffff0000ffff"],
        ["AffineProjection", "1,0,0,1,1,0", "000000ff000000ff00000000ffff0000ffff"],
    ])(`matches native %s %s, retained=${retained}`, async (method, points, hex) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const result = await runMagickCli(["/in.ppm", "-virtual-pixel", "black", "-filter", "point", "-distort", method!, points!, "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", "rgb:-"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("3x2 3x2+0+0;");
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(hex);
    });

    it.each(["", "0,0,1", "0,0,1,0,2", "NaN,0,1,0"])(`rejects incomplete or invalid points %s and preserves destination, retained=${retained}`, async points => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/out.png", original);
        const result = await runMagickCli(["/in.ppm", "-distort", "Shepards", points, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(points.includes("NaN") ? "invalid list of numbers" : "requires control points (4 numbers each)");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}

it("streams native geometry and Shepards pixels through the command", async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const argumentValues = createCommandArguments(["/in.ppm", "-virtual-pixel", "black", "-filter", "point", "-distort", "Shepards", "0,0 1,0  2,1 2,1", "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", "rgb:-"]);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(stderr).toString()).toBe("");
    expect(Buffer.concat(stdout)).toEqual(Buffer.concat([Buffer.from("3x2 3x2+0+0;"), Buffer.from("4900008080000049b680800049ffb6d12eff", "hex")]));
});
