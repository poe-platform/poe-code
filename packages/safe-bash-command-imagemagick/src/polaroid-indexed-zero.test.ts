import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for the asymmetric 8x6 PPM.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "indexed polaroid", operations: ["+dither", "-colors", "4", "-polaroid", "0"], size: 4896, hash: "a5222d1615036fc0ca91f0bba9a95bf09dc7b3e81dd31c57413919aa4c4739ef" },
        { name: "indexed export", operations: ["+dither", "-colors", "4"], size: 192, hash: "5c83eaa6361d872cbb75d093eaffc9fd02cf2f36d699882e6aab22e6f82721f6" },
        { name: "unquantized polaroid", operations: ["-polaroid", "0"], size: 4896, hash: "12837268ce85c50a91e9291a775d00e3874aaaa77955b2131686872151adeed4" },
        { name: "indexed polaroid page", operations: ["+dither", "-colors", "4", "-polaroid", "0"], page: "36x34,36x34+0-1" },
    ])(`${mode}: preserves native colors and geometry for $name`, async ({ operations, size, hash, page }) => {
        const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Buffer.from(Array.from({ length: 144 }, (_, i) => (i * 37 + 19) % 256))]);
        const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-seed", "7", "/im.ppm", ...operations, ...(page ? ["-format", "%wx%h,%Wx%H%X%Y", "info:/out"] : ["-depth", "8", "rgba:/out"])];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (page) expect(new TextDecoder().decode(output)).toBe(page);
        else {
            expect(output.length).toBe(size);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        }
    });
}
