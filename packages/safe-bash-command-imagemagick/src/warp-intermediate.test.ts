import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import { warpPixelSteps } from "./warp-kernel.js";
import fixtures from "./warp-intermediate-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-35 Q16-HDRI: input.png <args> -depth 8|16 -endian MSB rgba:-.
// Includes independent steps and PNG24 stage controls to distinguish intermediate rounding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode}: preserves native $kind intermediate warp samples: $args`, async fixture => {
        const input = Buffer.from(fixture.input, "base64"), files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...fixture.args, `PNG${fixture.depth === 16 ? 64 : 32}:/out.png`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const actual = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const bytes = Buffer.from(fixture.rgba, "base64");
        const expected = fixture.depth === 16 ? Uint16Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readUInt16BE(i * 2)) : new Uint8Array(bytes);
        expect(fixture.depth === 16 ? actual.data16 : actual.data).toEqual(expected);
    });
}

it("preserves fractional copied pixels across bounded storage pages and output chunks", () => {
    const width = 41, height = 27;
    const samples = Float64Array.from({ length: width * height * 4 }, (_, i) => (i % 255) + 0.25);
    const output = new Float64Array(samples.length), bytes = new Uint8Array(samples.length);
    const steps = warpPixelSteps({ width, height, hasAlpha: true, storedEvaluateSamples: 0 }, {
        width, height, hasAlpha: true, map: (x, y) => [x, y, true]
    }, { r: 0, g: 0, b: 0, a: 0 });
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read") {
            expect(request.evaluate).toBe(true);
            expect(request.length).toBeLessThanOrEqual(1024);
            const chunk = samples.subarray(request.position, request.position + request.length);
            next = steps.next(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        } else {
            if (request?.kind === "write") {
                expect(request.data.byteLength).toBeLessThanOrEqual(1024 * 4 * 8);
                if (request.evaluate) output.set(new Float64Array(request.data.slice().buffer), request.position);
                else bytes.set(request.data, request.position);
            }
            next = steps.next();
        }
    }
    expect(output).toEqual(samples);
    expect(bytes).toEqual(Uint8Array.from(samples, Math.round));
});
