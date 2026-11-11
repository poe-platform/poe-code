import { expect, it } from "vitest";
import { parse, parseAllDocuments } from "yaml";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: compare stable report fields, not timers.
for (const palette of [false, true]) it(`emits YAML through the public command (palette=${palette})`, async () => {
    const ppm = new Uint8Array([...new TextEncoder().encode("P6\n12 8\n255\n"), ...Array.from({ length: 288 }, (_, i) => (i * 53 + i * i * 7) % 256)]);
    const args = palette ? ["in.ppm", "+dither", "-colors", "5", "-unique-colors"] : ["-size", "2x1", "xc:red"];
    for (const output of ["yaml:-", "rgb:-"]) {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", ppm);
        const command = createMagickCommand(), argumentValues = createCommandArguments([...args, ...(output === "rgb:-" ? ["-depth", "8"] : []), output]);
        const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
            cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes); } }, stderr: { async write(bytes) { errors.push(bytes); } } });
        expect(result.exitCode).toBe(0);
        expect(Buffer.concat(errors).toString()).toBe("");
        const bytes = Buffer.concat(chunks);
        if (output === "rgb:-") expect(bytes.toString("hex")).toBe(palette ? "c2403b679079b6cb3f453abcbe3fcf" : "ff0000ff0000");
        else {
            expect(bytes.toString()).toMatch(/^---\n/);
            expect(parse(bytes.toString())).toMatchObject({ version: 1, image: {
                name: palette ? "in.ppm" : "xc:red", format: palette ? "PPM" : "XC", class: "DirectClass",
                geometry: { width: palette ? 5 : 2, height: 1, x: 0, y: 0 }, colorspace: "sRGB"
            } });
        }
        expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["in.ppm"]);
    }
});

for (const mode of ["sync", "map", "retained"]) {
    it.each(["yaml:report.yaml", "YAML:report.yaml", "report.yaml", "yaml:-", "yaml:"])(`writes YAML descriptions (${mode}, %s)`, async destination => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:red", "-format", "%wx%h", "-depth", "8", destination];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const stdout = destination === "yaml:-" || destination === "yaml:";
        const text = stdout ? result.stdout : new TextDecoder().decode(mode === "retained" ? await fs.readFile("/report.yaml") : files.get("report.yaml"));
        expect(parse(text)).toMatchObject({ version: 1, image: { format: "XC", baseDepth: 8, colorspace: "sRGB", geometry: { width: 3, height: 2 } } });
        expect(mode === "retained" ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()]).toEqual(stdout ? [] : ["report.yaml"]);
        if (!stdout) expect(result.stdout).toBe("");
        expect(result.stdoutBytes).toBeUndefined();
    });

    it.each(["-write", "+write"])(`preserves pixels, frames and escaped properties (${mode}, %s)`, async write => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const comment = 'a "quote", slash \\ and newline\n雪';
        const args = ["-size", "2x1", "xc:red", "-size", "1x1", "xc:blue", "-set", "comment", comment.replaceAll("\\", "\\\\"), "-depth", "8", write, "yaml:report.yaml", "-negate", "rgb:end.raw"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const text = new TextDecoder().decode(mode === "retained" ? await fs.readFile("/report.yaml") : files.get("report.yaml"));
        const documents = parseAllDocuments(text);
        expect(documents.flatMap(document => document.errors)).toEqual([]);
        expect(documents.map(document => document.toJSON())).toMatchObject([
            { image: { name: "xc:red", geometry: { width: 2, height: 1 }, properties: { comment } } },
            { image: { name: "xc:blue", geometry: { width: 1, height: 1 }, properties: { comment } } }
        ]);
        expect(mode === "retained" ? await fs.readFile("/end.raw") : files.get("end.raw")).toEqual(Uint8Array.of(0, 255, 255, 0, 255, 255, 255, 255, 0));
    });
}

it("streams intermediate and final YAML in bounded chunks", async () => {
    const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    const comment = "雪".repeat(5000);
    const result = await runConvertCli(["-size", "2x1", "xc:red", "-set", "comment", comment, "-write", "yaml:-", "-colorspace", "Gray", "yaml:-"], {
        filesystem: fs, cwd: "/", stdout: { async write(bytes) { expect(bytes.length).toBeLessThanOrEqual(4096); chunks.push(bytes); } }
    });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const documents = parseAllDocuments(Buffer.concat(chunks).toString());
    expect(documents.flatMap(document => document.errors)).toEqual([]);
    expect(documents.map(document => document.toJSON())).toMatchObject([
        { image: { colorspace: "sRGB", properties: { comment } } },
        { image: { colorspace: "Gray", properties: { comment } } }
    ]);
    expect(await fs.readdir("/")).toEqual([]);
});
