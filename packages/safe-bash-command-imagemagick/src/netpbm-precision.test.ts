import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

it("preserves all 16-bit PPM channel bytes when converting to PNG", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.dat", Buffer.from("50360a3220310a36353533350a1234456789abcdef13792468", "hex"));
    const args = createCommandArguments(["in.dat", "out.png"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const png = Buffer.from(await fs.readFile("/out.png"));
    expect(png[24]).toBe(16);
    // Inspect the PNG scanline independently of the image decoder.
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    const row = inflateSync(Buffer.concat(chunks));
    expect(row[0]).toBe(1); // Sub filter, six bytes per RGB16 pixel.
    for (let index = 7; index < row.length; index++) row[index] = (row[index]! + row[index - 6]!) & 255;
    expect(row.subarray(1).toString("hex")).toBe("1234456789abcdef13792468");
});

it.each(["P2", "P3", "P5", "P6"].flatMap(magic => [
    { maxval: 2, sample: 1, hex: "800080008000" },
    { maxval: 7, sample: 3, hex: "6db66db66db6" },
    { maxval: 255, sample: 127, hex: "7f7f7f7f7f7f" }
].map(test => ({ magic, ...test }))))("scales $magic maxval=$maxval directly to 16-bit output", async ({ magic, maxval, sample, hex }) => {
    const samples = Array(magic === "P3" || magic === "P6" ? 3 : 1).fill(sample);
    const input = Buffer.concat([
        Buffer.from(`${magic}\n1 1\n${maxval}\n`),
        magic === "P2" || magic === "P3" ? Buffer.from(samples.join(" ") + "\n") : Buffer.from(samples)
    ]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pnm", input);
    const args = createCommandArguments(["in.pnm", "-depth", "16", "-endian", "MSB", "rgb:out.raw"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(await fs.readFile("/out.raw")).toString("hex")).toBe(hex);
    const files = new Map<string, Uint8Array>([["/in.pnm", input]]);
    expect(await runConvertCli(["/in.pnm", "-depth", "16", "-endian", "MSB", "rgb:/out.raw"], files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(Buffer.from(files.get("/out.raw")!).toString("hex")).toBe(hex);
});
