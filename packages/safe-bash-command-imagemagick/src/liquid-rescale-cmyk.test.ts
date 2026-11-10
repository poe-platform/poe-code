import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI with liblqr; the same PAM inputs and arguments below.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        ["4x4!", false, 8, "cmyk", 64, "034b0ac0b9e4e5e9186bdb84380c8601474fc96c74748fe6fa38f7a0afa884e2"],
        ["6x4!", false, 8, "cmyk", 96, "dbdf1c685085fc666dae16b38f01e390962c097affa5da25f5ac9ac14471ae45"],
        ["5x4!", false, 8, "cmyk", 80, "51e46f8354267bdc9f36b7a2543422e52fb293224e15d0cafdc0030c2c922879"],
        ["5x3!", false, 16, "cmyk", 120, "c0e44cf7dbbc5922a464905932e538d841075ec339d9b3ed5de87c5b97e2d5db"],
        ["5x5!", false, 16, "cmyk", 200, "34a9c77a3e0d8615c4726e29fce60d12e6de86d4117f062f33d4d7d58949417b"],
        ["4x4!", true, 8, "cmyka", 80, "42556f0953a9c39235fd044e4f85cdc37f461f868cc89600a0b26f3a5e639a2f"],
        ["6x4!", true, 8, "cmyka", 120, "366d10bb7b05441e335a3c3bf015f2e223b19d589829caea9705ebb2489e43e0"],
        ["4x4!", true, 16, "cmyka", 160, "79c2a372a089e1db27ded07a25a2566043ce95ec3ece313af1dea518964eaaca"],
        ["6x4!", true, 16, "cmyka", 240, "7fe32491cf461423ce6477489402caf58a415209e5d0296baade4ac7e9b03d8d"],
        ["5x3!", true, 16, "cmyka", 150, "900663a591468b4593a0c67794a9177ed6187aeef7a6a0e5cb23d67606ccd714"],
        ["5x5!", true, 16, "cmyka", 250, "e035098be36aada87631dbd0af1ef8856d76477681620bc1c365a4361c53ffbf"],
        ["6x4!", false, 8, "rgb", 72, "b1c752977a147ff2eeab3ee0997a12e124848b4f673d3d36fe3849d5d08545b4"],
        ["6x4!", true, 16, "rgba", 192, "6dd57326731d8cacf7ecad8f7158fa96325a18b766f401b9ee692d50340beccc"],
    ] as const)(`${mode}: native %s alpha=%s depth=%s output=%s`, async (geometry, alpha, depth, coder, size, hash) => {
        const input = Buffer.concat([
            Buffer.from(`P7\nWIDTH 5\nHEIGHT 4\nDEPTH ${alpha ? 5 : 4}\nMAXVAL ${depth === 8 ? 255 : 65535}\nTUPLTYPE ${alpha ? "CMYK_ALPHA" : "CMYK"}\nENDHDR\n`),
            Uint8Array.from({ length: 20 * (alpha ? 5 : 4) * (depth / 8) }, (_, i) => (i * 53 + 11) % 256)
        ]);
        const files = new Map<string, Uint8Array>([["/ink.pam", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/ink.pam", "-liquid-rescale", geometry, "-depth", String(depth), "-endian", "MSB", `${coder}:/out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        expect(output.length).toBe(size);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
