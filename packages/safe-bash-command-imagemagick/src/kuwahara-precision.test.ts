import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete raw RGB output.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const fixture of [
    { name: "calculated RGB16", options: ["-kuwahara", "1x1"], depth: "16", expected: "47a46cc97dfeb4cb5429655eb4cb5429655e69e28f07808786a397d86adb84e6766667e7" },
    { name: "Gray working samples", options: ["-colorspace", "Gray", "-kuwahara", "1x1"], depth: "8", expected: "6666666a6a6a6a6a6a868686909090787878" },
    { name: "RGB16 input", inputDepth: 16, options: ["-kuwahara", "1x1"], depth: "16", expected: "47f26d197e64b555553a6685b555553a66856aa98fd0818687a298ed6c44863b77f169a7" },
    { name: "Gray16 output", options: ["-colorspace", "Gray", "-kuwahara", "1x1"], depth: "16", expected: "66216621662169f369f369f369f369f369f386158615861590f090f090f0787078707870" },
    { name: "repeated filtering", options: ["-kuwahara", "1x1", "-kuwahara", "1x1"], depth: "16", expected: "6957720f78128fa368ae6d4ca796604a664d6e97855a798e84e67e696f009296739567ca" },
    { name: "RGB8 control", options: ["-kuwahara", "1x1"], depth: "8", expected: "476c7eb45465b45465698e8086976a847667" },
    { name: "unfiltered RGB16 control", options: [], depth: "16", expected: "131338385d5d8282a7a7ccccf1f116163b3b60608585aaaacfcff4f419193e3e63638888" },
]) it(`preserves Kuwahara ${fixture.name} (${mode})`, async () => {
    const pixels = Buffer.alloc(18 * (fixture.inputDepth === 16 ? 2 : 1));
    for (let i = 0; i < 18; i++) {
        if (fixture.inputDepth === 16) pixels.writeUInt16BE((i * 9511 + 4883) % 65536, i * 2);
        else pixels[i] = (i * 37 + 19) % 256;
    }
    const input = Buffer.concat([Buffer.from(`P6\n3 2\n${fixture.inputDepth === 16 ? 65535 : 255}\n`), pixels]);
    const files = new Map<string, Uint8Array>([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", ...fixture.options, "-depth", fixture.depth, "-endian", "MSB", "rgb:/out.rgb"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect(Buffer.from(output).toString("hex")).toBe(fixture.expected);
});
