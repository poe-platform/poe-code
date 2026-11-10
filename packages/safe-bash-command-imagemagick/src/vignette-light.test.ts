import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA8 output.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["SoftLight", "c86c309764e13bd28ca629a45b6a9a2e8f8414430961d39418be363ae9b14a54", 0, "69c1ffff"],
        ["HardLight", "c0212f13a64702c7c8a20830eb2c873ab0c3c57da6637d3e4152aeb29abc3525", 1, "5084a6ff"],
        ["Over", "9172bf73a4d2fe86704edef1c763740753681ae64c69669609b58efb83239d8e", 0, "4e7d9eff"],
        ["", "9172bf73a4d2fe86704edef1c763740753681ae64c69669609b58efb83239d8e", 0, "4e7d9eff"],
    ] as const)(`matches native vignette %s (${backend})`, async (compose, digest, pixel, rgba) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n8 6\n255\n"),
            ...Array.from({ length: 144 }, (_, i) => (i * 37 + 19) % 256)]);
        const files = new Map([["/im.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", "-background", "#5080a0", ...(compose ? ["-compose", compose] : []),
            "-vignette", "0x1+1+1", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(192);
        expect.soft(Buffer.from(output.subarray(pixel * 4, pixel * 4 + 4)).toString("hex")).toBe(rgba);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
