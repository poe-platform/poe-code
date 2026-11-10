import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P7\nWIDTH 5\nHEIGHT 4\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"), Buffer.from(Array.from({ length: 80 }, (_, i) => (i * 53 + 11) % 256))]);
// ImageMagick 7.1.2-35 Q16-HDRI raw CMYK8 outputs from the same PAM bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { geometry: "4x3!", size: 48, hash: "9cf6f9de2ce360c7b39c892dbd9fdec660f513cae1b08a9ce9d53490801d38e3" },
        { geometry: "7x6!", size: 168, hash: "9e0dfadb38e629419e53a3b922ac4116525a77c0e60b3af0c3d96f108b3633fa" },
        { geometry: "5x4!", size: 80, hash: "51e46f8354267bdc9f36b7a2543422e52fb293224e15d0cafdc0030c2c922879" },
    ])(`${mode}: adaptively resizes CMYK ink planes to $geometry`, async ({ geometry, size, hash }) => {
        const filesystem = new MemoryFileSystem(), files = new Map([["/ink.pam", input], ["/out", Buffer.from("KEEP")]]);
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const args = ["/ink.pam", "-adaptive-resize", geometry, "-depth", "8", "cmyk:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const actual = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(actual.byteLength).toBe(size);
        expect(createHash("sha256").update(actual).digest("hex")).toBe(hash);
    });
}
