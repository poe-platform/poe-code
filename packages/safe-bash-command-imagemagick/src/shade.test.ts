import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCliSync } from "./index.js";
import fixture from "./shade-fixture.json" with { type: "json" };

// Full PNG32 rasters from ImageMagick 7.1.2-31 Q16-HDRI.
for (const { angle, rgba } of fixture.cases) {
    it.each(["public", "buffered", "sync"])(`matches native directional relief ${angle} through %s`, async mode => {
        const input = Uint8Array.from(Buffer.from(fixture.input, "base64"));
        const fs = new MemoryFileSystem(), files = new Map([["/i.png", input]]);
        await fs.writeFile("/i.png", input);
        const args = ["/i.png", "-shade", angle, "PNG32:/o.png"];
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
            expect(result).toMatchObject({ exitCode: 0 });
        }
        const output = mode === "public" ? await fs.readFile("/o.png") : files.get("/o.png")!;
        expect([...decodeImage(output).data]).toEqual(rgba);
    });
}

it("rejects deprecated +shade without publishing output", () => {
    const files = new Map([["/i.png", Uint8Array.from(Buffer.from(fixture.input, "base64"))]]);
    expect(runConvertCliSync(["/i.png", "+shade", "30x45", "/o.png"], files).exitCode).not.toBe(0);
    expect(files.has("/o.png")).toBe(false);
});

for (const { options, rgba } of fixture.variants) {
    it(`matches native settings ${options.join(" ") || "without shade"}`, async () => {
        const input = Uint8Array.from(Buffer.from(fixture.input, "base64"));
        const files = new Map([["/i.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/i.png", input);
        const args = ["/i.png", ...options, "PNG32:/o.png"];
        expect(runConvertCliSync(args, files).exitCode).toBe(0);
        expect([...decodeImage(files.get("/o.png")!).data]).toEqual(rgba);
        expect((await runConvertCli(args, { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
        expect([...decodeImage(await fs.readFile("/o.png")).data]).toEqual(rgba);
    });
}

it.each(["", "bad", "30", "30x", "30x45x60", "Infinity"])("rejects invalid shade %s without replacing output", async spec => {
    const input = Uint8Array.from(Buffer.from(fixture.input, "base64"));
    const files = new Map([["/i.png", input], ["/o.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/i.png", input);
    await fs.writeFile("/o.png", input);
    const args = ["/i.png", "-shade", spec, "/o.png"];
    expect(runConvertCliSync(args, files).exitCode).not.toBe(0);
    expect(files.get("/o.png")).toEqual(input);
    expect((await runConvertCli(args, { filesystem: fs, cwd: "/" })).exitCode).not.toBe(0);
    expect(await fs.readFile("/o.png")).toEqual(input);
});

it("preserves native 16-bit shade samples", async () => {
    const input = Uint8Array.from(Buffer.from(fixture.highDepth.input, "base64"));
    const files = new Map([["/i.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/i.png", input);
    const args = ["/i.png", "-shade", "30x45", "PNG64:/o.png"];
    expect(runConvertCliSync(args, files).exitCode).toBe(0);
    expect((await runConvertCli(args, { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    const expected = Uint16Array.from({ length: fixture.highDepth.rgba.length / 2 }, (_, i) => fixture.highDepth.rgba[i * 2]! + 256 * fixture.highDepth.rgba[i * 2 + 1]!);
    expect(decodeImage(files.get("/o.png")!).data16).toEqual(expected);
    expect(decodeImage(await fs.readFile("/o.png")).data16).toEqual(expected);
});

it("applies shade through mogrify", () => {
    const files = new Map([["/i.png", Uint8Array.from(Buffer.from(fixture.input, "base64"))]]);
    expect(runMogrifyCliSync(["-shade", "30x45", "/i.png"], files).exitCode).toBe(0);
    expect([...decodeImage(files.get("/i.png")!).data]).toEqual(fixture.cases[0]!.rgba);
});
