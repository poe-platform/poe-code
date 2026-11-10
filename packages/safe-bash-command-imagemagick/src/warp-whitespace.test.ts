import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (Math.floor(i / 4) * [31, 73, 47][i % 4]! + [20, 80, 13][i % 4]!) % 256);

// Raw RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "convert", "retained", "buffered", "sync"] as const)
for (const [option, geometries, size, hash] of [
    ["-swirl", ["20", "2 0", "%[option:warp]"], 48, "729baf05032e42c3a2e04223861ebf9af6fb23dd85247a7e806e2c4b4641f98d"],
    ["-implode", ["20", "2 0", "%[option:warp]"], 48, "ff33b9c68168a17f93514c9bd53edb63c58a901a864f52b398f4c39812bbc756"],
    ["-wave", ["20", "2 0", "%[option:warp]"], 688, "96052c976c83b0f6e27199009ed1f06efd5bea09554596a27ea463d8ec655f97"],
    ["-swirl", ["2"], 48, "90ed9de51bb75b044be40e52a312a671759e58acfdd18ff7ada10f1d2a7d6741"]
] as const) {
    it.each(geometries)(`${mode}: ${option} %s matches native whitespace parsing`, async geometry => {
        const files = new Map([["/input.raw", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-size", "4x3", "-depth", "8", "rgba:/input.raw", "-set", "option:warp", "2 0", option, geometry, "-depth", "8", "rgba:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" || mode === "convert" ? {
            ...await (mode === "command" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode === "command" ? "magick" : "convert", args: createCommandArguments(argv).args,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr
        } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "sync" || mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
        expect(output).toHaveLength(size);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
