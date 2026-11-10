import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";
import fixtures from "./miff-cmyk-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI:
// Input RGBA: 1234abcdff0080ff1234abcd55660080, repeated twice.
// magick -size 4x2 -depth 8 rgba:- -colorspace SPACE [-alpha off] -depth DEPTH -define quantum:format=unsigned -compress None miff:-
// Expectations: -format '%[colorspace]|%[channels]|%[fx:k]' info:,
// -colorspace sRGB -depth 8 rgba:-, and -colorspace sRGB PNG64:- decoded as big-endian RGBA16.
for (const fixture of fixtures) for (const mode of ["command", "sync"] as const) {
    it.each(["info", "raw", "png"] as const)(`${mode}: ${fixture.space} MIFF depth=${fixture.depth} alpha=${fixture.alpha} to %s`, async output => {
        const input = Buffer.from(fixture.miff, "base64"), keep = new TextEncoder().encode("KEEP");
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["in.miff", input], ["out", keep]]);
        await fs.writeFile("/in.miff", input);
        await fs.writeFile("/out", keep);
        const args = ["in.miff", ...(output === "info" ? ["-format", "%[colorspace]|%[channels]|%[fx:k]", "info:"]
            : ["-colorspace", "sRGB", ...(output === "raw" ? ["-depth", "8", "rgba:out"] : ["PNG64:out"])])];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        if (output === "info") expect("stdout" in result ? result.stdout : stdout).toBe(fixture.info);
        else {
            const bytes = mode === "sync" ? files.get("out")! : await fs.readFile("/out");
            if (output === "raw") expect(Buffer.from(bytes).toString("hex")).toBe(fixture.rgba);
            else {
                const expected = Buffer.from(fixture.rgba16, "hex");
                expect([...decodeImage(bytes).data16!]).toEqual(Array.from({ length: expected.length / 2 }, (_, index) => expected.readUInt16BE(index * 2)));
            }
        }
    });
}

it("rejects truncated CMYKA MIFF without replacing the destination", async () => {
    const fs = new MemoryFileSystem(), input = Buffer.from(fixtures[0]!.miff, "base64");
    await fs.writeFile("/in.miff", input.subarray(0, input.length - 1));
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: ["in.miff", "-colorspace", "sRGB", "rgba:out"], cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("Truncated MIFF raster");
    expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("KEEP");
});
