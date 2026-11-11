import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n255 255 0  0 255 255  255 0 255\n");

// ImageMagick 7.1.2-35 Q16-HDRI, black virtual pixels; point filter unless specified.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { name: "default radius", coefficients: "0", pixels: "41430280400041024324432000ff80242043" },
        { name: "furthest corner", coefficients: "-1", pixels: "f8bf05800700b707fd87dc5900ff0e6478e0" },
        { name: "explicit radius", coefficients: "2,0", pixels: "f8a0058000009907fc87cc4a00ff005378d1" },
        { name: "explicit center", coefficients: "2,0,1,1", pixels: "df2e002e00dfd417ea60b321149f818c5fea" },
        { name: "partial circle", coefficients: "2,0,1,1,0,180", pixels: "0000002840cc48a2ea000000bf670d48eaa2" },
        { name: "reversed angles", coefficients: "2,0,1,1,180,0", pixels: "000000bf670d48eaa20000002840cc48a2ea" },
        { name: "starting angle", coefficients: "2,0,1,1,90", pixels: "60b321df2e00999900149f812e00df990099" },
        { name: "equal angles", coefficients: "2,0,1,1,90,90", pixels: "60b321df2e00999900149f812e00df990099" },
        { name: "best fit", operator: "+distort", coefficients: "0", geometry: "4x4 4x4-2-2", pixels: "000000000000000000000000000000dfcc00cc00df00000000000060f792579ff1000000000000000000000000000000" },
        { name: "best fit retained center", operator: "+distort", coefficients: "0,0", geometry: "3x4 3x4+0-1", pixels: "00000000000000000041430280400041024324432000ff80242043000000000000000000" },
        { name: "default filter", options: [], coefficients: "0", pixels: "67570676330054036d3b6b2a12c86d30326d" },
        { name: "nonzero inner radius", coefficients: "2,0.5", pixels: "f858024000005007fa87a4270080002c78ae" },
        { name: "viewport", options: ["-filter", "point", "-define", "distort:viewport=2x2+1+0"], coefficients: "0", geometry: "2x2 2x2+1+0", pixels: "80400041024300ff80242043" },
        { name: "scaled", options: ["-filter", "point", "-define", "distort:scale=2"], coefficients: "0", geometry: "6x4 6x4+0+0", pixels: "000000545400999900990099540054000000000000d4ea17df2e002e00dfd417ea0000000000008cea5f60b321149f818c5fea00000000000024613c24eac624c6ea243c61000000" },
        { name: "page", options: ["-filter", "point", "-repage", "10x8+1+2"], coefficients: "0", geometry: "3x2 10x8+0+0", pixels: "000000000000000000000000000000000000" },
        { name: "best fit page", options: ["-filter", "point", "-repage", "10x8+1+2"], operator: "+distort", coefficients: "0,0", geometry: "3x4 10x16+1+1", pixels: "00000000000000000041430280400041024324432000ff80242043000000000000000000" },
        { name: "center", coefficients: "2,0,1.5,0.5", pixels: "bf9f200080006040df60f79200ff80579ff1" },
        { name: "affine control", method: "AffineProjection", coefficients: "1,0,0,1,1,0", pixels: "000000ff000000ff00000000ffff0000ffff" },
    ])(`renders $name via ${mode}`, async ({ coefficients, pixels, geometry = "3x2 3x2+0+0", operator = "-distort", method = "Polar", options = ["-filter", "point"] }) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-virtual-pixel", "black", ...options, operator, method, coefficients, "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
        if (mode === "command") {
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            expect(Buffer.concat(chunks)).toEqual(Buffer.concat([Buffer.from(geometry + ";"), Buffer.from(pixels, "hex")]));
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stderr).toBe("");
            expect(result.stdout).toBe(geometry + ";");
            expect(Buffer.from(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!).toString("hex")).toBe(pixels);
        }
    });
}

it.each([
    ["1,0,0", "number of arguments"], ["1,0,0,0,0,360,1", "number of arguments"],
    ["-2", "Invalid Radius"], ["1,1", "Invalid Radius"], ["1,-1", "Invalid Radius"],
    ["NaN", "invalid list of numbers"], ["", "invalid list of numbers"],
])("rejects invalid Polar coefficients %s without replacing the destination", async (coefficients, diagnostic) => {
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const original = new TextEncoder().encode("KEEP"), files = new Map([["/in.ppm", input], ["/out.png", original]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const result = await runMagickCli(["/in.ppm", operator, "Polar", coefficients, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(diagnostic);
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    }
});
