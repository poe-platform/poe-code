import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, using the same inline pixels and lime background.
const cases = [
    { virtualPixel: "edge", sharpen: "4060708f9b84", blur: "40607072867d" },
    { virtualPixel: "tile", sharpen: "234a69809080", blur: "5b7577809080" },
    { virtualPixel: "background", sharpen: "5d02adce57c9", blur: "25b83737c63b" },
    { virtualPixel: "mirror", sharpen: "4060708f9b84", blur: "40607072867d" },
    { virtualPixel: "transparent", sharpen: "406070809080", blur: "406070809080" },
    { virtualPixel: "black", sharpen: "5d91adcee5c9", blur: "25323737403b" },
    { virtualPixel: "gray", sharpen: "164966879e82", blur: "67757a7a837e" },
    { virtualPixel: "white", sharpen: "00021f40573b", blur: "aab8bcbcc6c1" },
    { virtualPixel: "horizontal-tile", sharpen: "500ea0c767be", blur: "31ad433db646" },
    { virtualPixel: "vertical-tile", sharpen: "406070809080", blur: "406070809080" },
    { virtualPixel: "checker-tile", sharpen: "4d109dc66bbb", blur: "34ab463eb349" },
    { virtualPixel: "horizontal-tile-edge", sharpen: "234a69809080", blur: "5b7577809080" },
    { virtualPixel: "vertical-tile-edge", sharpen: "4060708f9b84", blur: "40607072867d" },
    { virtualPixel: "dither", sharpen: "234a69809080", blur: "5b7577809080" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const operation of ["sharpen", "blur"] as const)
it.each(cases)(`${mode}: adaptive ${operation} uses $virtualPixel virtual pixels`, async fixture => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), chunks: Uint8Array[] = [];
    const args = ["xc:#406070", "xc:#809080", "+append", "-background", "lime", "-virtual-pixel", fixture.virtualPixel,
        `-adaptive-${operation}`, "1x1", "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out.rgb"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks) : mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect(Buffer.from(output).toString("hex")).toBe(fixture[operation]);
});

for (const mode of ["sync", "retained"] as const)
for (const operation of ["sharpen", "blur"] as const)
it.each([
    { virtualPixel: "edge", sharpen: "75f000a2c08410f849aa94dc1503a27700253f280b6102c85a9ed540c25c005d", blur: "8e8c9918b7dcbf2ea4b0f1efb271170f2fba009aa56fa0c25deec5faa154b0af" },
    { virtualPixel: "tile", sharpen: "43b547862350b135c258d2fb33d1c757c55847240c55724c55ca748c7c2ce59c", blur: "e8b3c9477592f70eac65a0de892d195e99e406907ae956ee2b08934ef605db0d" },
    { virtualPixel: "background", sharpen: "ed1417fb138da9d96c7a72d50b118a4530cd7f0c09b530a1f07523c40c702347", blur: "4ab642d85294c8476fb8c5c886e09c3c4db09342fa4f6f8e3f47ad3e46b7a375" },
    { virtualPixel: "mirror", sharpen: "a69ff00c1811a0c6107c37e6357330873ff8ac8bb764eece39fe282b35861daf", blur: "449aaf92d3843355ff04c97ff88bb7bf8555f6fba5d3b2b813755d645b61e8ca" },
])(`${mode}: adaptive ${operation} samples $virtualPixel across chunk boundaries`, async fixture => {
    const input = Buffer.concat([Buffer.from("P6\n257 5\n255\n"), Buffer.from(Array.from({ length: 257 * 5 * 3 }, (_, i) => (i * i * 7 + 17 * i + 23) % 256))]);
    const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-background", "lime", "-virtual-pixel", fixture.virtualPixel,
        `-adaptive-${operation}`, "0x1", "-depth", "8", "rgb:/out.rgb"];
    const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
    expect(output.length).toBe(257 * 5 * 3);
    expect(createHash("sha256").update(output).digest("hex")).toBe(fixture[operation]);
});
