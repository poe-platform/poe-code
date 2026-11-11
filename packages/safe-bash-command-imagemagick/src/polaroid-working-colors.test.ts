import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: complete RGBA output, including frame-edge opacity.
for (const mode of ["command", "buffered", "sync"] as const) it.each([
    { colorspace: "Lab", angle: undefined, bytes: 192, hash: "dff0c92b6550d13fc356ed60c795b54da6472b4a29502b960e80103dfb16003e" },
    { colorspace: "Lab", angle: "0", bytes: 4896, hash: "46d5d26b57ac2dc2155756f71cde6adce0713ad9b955e32ff46fe50e295776f4" },
    { colorspace: "Lab", angle: "12", bytes: 7392, hash: "d6a81d8544185e55f602e9bcb0891e085a70a5a1abe4d3676a9e440c89ae8f6c" },
    { colorspace: "HSL", angle: undefined, bytes: 192, hash: "c0444224d550c67b90aafd4a35f34dfa580a135e662afa84a2d45d14cfabca2a" },
    { colorspace: "HSL", angle: "0", bytes: 4896, hash: "6979071dce38d4541ee4d665788bed65c3603c4219b1a9db0d5718dcdf300084" },
    { colorspace: "HSL", angle: "12", bytes: 7392, hash: "72b0ef1dacf841eb79be141fe3f36e3b45bd8b6977298b0364ecd55059b4a290" },
    { colorspace: "XYZ", angle: undefined, bytes: 192, hash: "5bf2e71bfdbd2cd1bca288f5d7a2c74752f82d23eea0a255ae734f073bdbb928" },
    { colorspace: "XYZ", angle: "0", bytes: 4896, hash: "c438db3a0508d8ce025ab72956ea929643d163b2b853e52cc073151bd61df600" },
    { colorspace: "XYZ", angle: "12", bytes: 7392, hash: "97c944d950a368a6fa91ad7156b3bcb3437b6e5d4850b4e6f6b070cd4bdf806d" },
    { colorspace: "srgb", angle: undefined, bytes: 192, hash: "df01de6dfd615e2e6c46753392104d7babe0715413320d1fea6d81ec66cbcf72" },
    { colorspace: "srgb", angle: "0", bytes: 4896, hash: "c373566d15ca487b1ed4de45f62e9356fd168ca26c61534c4a82450e1f7540a8" },
    { colorspace: "srgb", angle: "12", bytes: 7392, hash: "b0eefcf279bdc8cd5351f54ff29f74010ae655ee933794ab63910f1e00eed893" },
])(`${mode}: preserves $colorspace polaroid colors and opacity at $angle degrees`, async ({ colorspace, angle, bytes, hash }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-seed", "7", "-size", "8x6", "xc:red", "-colorspace", colorspace,
        ...(angle === undefined ? [] : ["-polaroid", angle]), "-depth", "8", "rgba:out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files) : mode === "buffered" ? await runMagickCli(argv, files) : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
    });
    expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(0);
    const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
    expect(output.byteLength).toBe(bytes);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
