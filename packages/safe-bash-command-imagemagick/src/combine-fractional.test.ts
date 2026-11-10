import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including 8-bit controls.
for (const mode of ["buffered", "sync", "retained", "command"])
for (const fixture of [
    { inputs: ["xc:red", "xc:lime", "xc:blue"], outputs: ["36b612ff", "3670b714127bffff"] },
    { inputs: Array<string>(4).fill("/in.pam"), outputs: ["585858585a5a5a5a", "588258825882588259e159e159e159e1"] },
    { inputs: ["xc:#444444", "xc:#666666", "xc:#999999"], outputs: ["446699ff", "444466669999ffff"] }
])
for (const [index, depth] of [8, 16].entries())
it(`combines fractional intensities (${mode}, ${fixture.inputs[0]}, depth=${depth})`, async () => {
    const pam = Buffer.concat([
        Buffer.from("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("2060b080c84011ef", "hex")
    ]);
    const files = new Map<string, Uint8Array>([["/in.pam", pam], ["/out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(name, bytes);
    const argv = [...fixture.inputs, "-combine", "-colorspace", "sRGB", "-depth", String(depth), "-endian", "MSB", "rgba:/out"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(fixture.outputs[index]);
});
