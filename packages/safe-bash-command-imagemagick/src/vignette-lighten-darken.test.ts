import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, patterned PPM to raw row-major RGBA8.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["Lighten", "13660a0cf293a505ce6d76f61e9880f5e72611b43252478f29b7809dc2a3b715"],
        ["Darken", "a7060a8d9b0319bb03822af39856d6056b799064d3dbdc211d22842020f2af8f"],
        ["Over", "9172bf73a4d2fe86704edef1c763740753681ae64c69669609b58efb83239d8e"],
        ["", "9172bf73a4d2fe86704edef1c763740753681ae64c69669609b58efb83239d8e"],
    ])(`matches native patterned vignette compose=%s (${backend})`, async (compose, digest) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n8 6\n255\n"),
            ...Uint8Array.from({ length: 144 }, (_, i) => (i * 37 + 19) % 256)]);
        const files = new Map([["/im.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", "-background", "#5080a0", ...(compose ? ["-compose", compose] : []),
            "-vignette", "0x1+1+1", "-depth", "8", "rgba:/out"];
        let stdout = "", stderr = "";
        const result = backend === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("");
        const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(192);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
