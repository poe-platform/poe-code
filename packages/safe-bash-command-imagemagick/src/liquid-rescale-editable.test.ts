import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI with liblqr. Black input isolates mask movement from source colors.
const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
const mask = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.from(Array.from({ length: 20 }, (_, i) => i % 2 * 255))]);
const fixtures = [
    ["write-mask", "4x4!", 48, "9a5aa8110490928687ab1eeaed1d3b1d7085bd74d5833e400c8bccc0484e6abf"],
    ["write-mask", "6x4!", 72, "c375044bd8ad20f078145421fd9733d44377922acbdca0249254d96056246e3a"],
    ["write-mask", "5x4!", 60, "3ac578ab43aa3117284a265bf0ed160eb92c8360290d2a961e8618b379147627"],
    ["region", "4x4!", 48, "47791cb08ee135db39cdc5374306b2e4bff3e2ca23fba3d0948fc282b8a7646d"],
    ["region", "6x4!", 72, "fcd138b3e4da78197401bbdf3bb1c9d09879ac893c8f0910bfcf29760b1a14ac"],
    ["region", "5x4!", 60, "bbae4f6be4efd718f0b93a50f8ead793ea4a24408be32087a9a8df977c282fd9"],
] as const;

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures)(`keeps editable pixels aligned for %s at %s (${mode})`, async (kind, geometry, length, sha256) => {
        const files = new Map([["/im.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/im.ppm", "-fill", "black", "-colorize", "100%", `-${kind}`, kind === "region" ? "2x2+1+0" : "/mask.pgm",
            "-liquid-rescale", geometry, "-fill", "white", "-colorize", "100%", `+${kind}`, "-depth", "8", "rgb:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(output).toHaveLength(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(sha256);
    });
}
