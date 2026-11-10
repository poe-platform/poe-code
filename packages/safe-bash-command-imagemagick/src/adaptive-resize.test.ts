import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./adaptive-resize-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-31 Q16-HDRI outputs for the asymmetric 5x3 RGB input.
for (const fixture of fixtures) for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it(`adaptively resizes ${fixture.name} to ${fixture.geometry} (${mode})`, async () => {
        const input = Buffer.from(fixture.input, "base64");
        const files = new Map([["/input.png", input as Uint8Array]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const run = async (args: string[]) => {
            if (mode !== "public") return mode === "sync" ? runMagickCliSync(args, files)
                : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            return { ...result, stdout, stderr };
        };
        const result = await run(["/input.png", "-adaptive-resize", fixture.geometry, "PNG24:/output.png"]);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" || mode === "public" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect(Buffer.from(output.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(fixture.rgb);
        expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout).toBe(fixture.page);
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for an 8-bit 5x4 PPM.
for (const fixture of [
    { args: ["-adaptive-resize", "4x3!", "-depth", "16", "-endian", "MSB"], size: 72, hash: "a5cdb7ef33a1ac751a12e45cf3b49e129548300633ec61ecd64e8a9eabbd8552" },
    { args: ["-adaptive-resize", "4x3!", "-evaluate", "multiply", "3.71", "-depth", "8"], size: 36, hash: "f719e158e4bcb30b6d637eb149e5220279ba0335cea9c08abf220b7dc44f586f" },
    { args: ["-adaptive-resize", "7x6!", "-adaptive-resize", "5x4!", "-depth", "8"], size: 60, hash: "f286c3767642b39367308fff92c74f0daacf99dee30ab012ecf3e1e3da599367" },
    { args: ["-adaptive-resize", "4x3!", "-depth", "8"], size: 36, hash: "dd50a492c698a2b9519d14ac38de901ab9376ce35694d7458b78552924395086" },
    { args: ["-adaptive-resize", "5x4!", "-depth", "16", "-endian", "MSB"], size: 120, hash: "d173472f34909a392ba40ae2d31830a3c115ecc2735a9a8a5dc02613d9417d5a" }
]) for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it(`retains adaptive resize precision for ${fixture.args.join(" ")} (${mode})`, async () => {
        const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>([["/input.ppm", input], ["/output", Buffer.from("KEEP")]]);
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const args = ["/input.ppm", ...fixture.args, "rgb:/output"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = mode === "retained" || mode === "public" ? await filesystem.readFile("/output") : files.get("/output")!;
        expect(output.length).toBe(fixture.size);
        expect(createHash("sha256").update(output).digest("hex")).toBe(fixture.hash);
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for the 5x4 PPM boundary reproduction.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { name: "tile", settings: ["-virtual-pixel", "tile"], hash: "3c48eb8eba848f882616da098cb4ba6d0dac3f54649532f18ee7a843690f9e52" },
        { name: "red background", settings: ["-background", "red", "-virtual-pixel", "background"], hash: "a62c1984e8a18ad2b11284b0ad48396ac4775bd6994ac188e4928cd2aa024f1a" },
        { name: "edge", settings: ["-virtual-pixel", "edge"], hash: "37895eb1e5ec68629077d7c2682e1f6a1be18fa2b2cb08d8d51401aa0de8c403" },
        { name: "default", settings: [], hash: "37895eb1e5ec68629077d7c2682e1f6a1be18fa2b2cb08d8d51401aa0de8c403" }
    ])(`honors $name virtual pixels during adaptive enlargement (${mode})`, async ({ settings, hash }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n5 4\n255\n"), ...Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256)]);
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/im.ppm", input], ["/out", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/im.ppm", input);
        await filesystem.writeFile("/out", original);
        const args = ["/im.ppm", ...settings, "-adaptive-resize", "7x6!", "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "public" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        const output = mode === "retained" || mode === "public" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(126);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
