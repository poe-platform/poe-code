import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA16 output (big endian).
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["PinLight", [], [], "f2ec296638ffb3a532665e622d820857eeff07e3bde9ff32a326088ca2834651"],
        ["ModulusAdd", [], [], "489b5b8f88d610dc6764708e31f0a7168140973246b03245f8d1f69ca9e02b62"],
        ["Hue", [], [], "58bfd89a464c33435211695c9f1c02a94d0e2256105158d594f7c2014ccbaefb"],
        ["Blend", [], [], "d432b1270309a5e51742cb8ea774ce1796726b2ebb56eec0b135472b8c9656fb"],
        ["PinLight", [], ["-channel", "R"], "3714f9de9f73ec6b88e7910b6fcc661f9b473e34c14fcb022bf49e4e16a96fe6"],
        ["Hue", [], ["-channel", "A"], "4c593ca4549bf2f0ca467433321172389087f14741f4ce1df6f08ad80aa6686c"],
        ["PinLight", [], ["-region", "3x2+1+1"], "75b21b21949b82677628285012718935e4f33e635d4bf33ab58d6bd5b3fc580c"],
        ["PinLight", ["-colorspace", "CMYK"], [], "a3d859fc1239fb5025d477476f7c92af77c23eb43408ecb69e3d4d72808a1e22"],
        ["PinLight", ["-colorspace", "RGB"], [], "6a68ba278204690e72c0bb3c1effd88a8a9b529a62443dba155087bbdcf21ac4"],
    ] as const)(`preserves native vignette %s with %j %j (${backend})`, async (compose, colorspace, options, digest) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "7x5", "xc:#c0306090", ...colorspace, "-background", "#2880b070", ...options,
            "-compose", compose, "-vignette", "0x1+1+1", ...(colorspace.length ? ["-colorspace", "sRGB"] : []),
            "-depth", "16", "-endian", "MSB", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(7 * 5 * 4 * 2);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
