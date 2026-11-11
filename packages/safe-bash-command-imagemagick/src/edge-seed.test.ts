import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGB8 bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { seed: "3", method: "random", hex: "000000585858989898" },
        { seed: "4", method: "random", hex: "000000484848606060" },
        { seed: "3", method: "edge", hex: "000000303030181818" },
    ])(`${mode}: edge seed=$seed with $method virtual pixels`, async ({ seed, method, hex }) => {
        for (let repeat = 0; repeat < 3; repeat++) {
            const argv = ["xc:#505050", "xc:#686868", "xc:#707070", "+append", "-seed", seed,
                "-virtual-pixel", method, "-edge", "1", "-seed", "99", "-depth", "8",
                mode === "command" ? "rgb:-" : "rgb:/out"];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = createCommandArguments(argv), stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const pixels = mode === "command" ? Buffer.concat(stdout)
                : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(pixels).toString("hex")).toBe(hex);
        }
    });
}

for (const mode of ["retained", "sync"] as const) {
    it.each([
        { width: 1025, height: 3, radius: "1", seed: "3", hash: "32b6919045fe8577236c3e1d10ffc8c255ea2ae1bc253735209a9d5c56440623" },
        { width: 5, height: 3, radius: "2", seed: "4", hash: "e2dece5be1250ea99e81e0040e38c3e5e9a73cdeae8b1238fd795ccab035ac82" },
        { width: 1, height: 1, radius: "0", seed: "3", hash: "709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c" },
        { width: 5, height: 3, radius: "1", seed: "0", hash: "61772a53f3fff49e1599df9d2b651841ce7380b729459de65c4d21240639952e" },
        { width: 5, height: 3, radius: "1", seed: "9007199254740993", hash: "8505700a15bc33f6f3ed13aaaf113cc1d0ffcba7adafab549f688ae04fea7b28" },
    ])(`${mode}: seeded edge $width x $height radius=$radius seed=$seed`, async ({ width, height, radius, seed, hash }) => {
        const input = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(
            Array.from({ length: width * height }, (_, i) => [111 + 2 * (i % 7), 103 + 4 * (i % 3), 125 + 2 * (i % 5)]).flat()
        )]);
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-seed", seed, "-virtual-pixel", "random", "-edge", radius, "-depth", "8", "rgb:/out"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const pixels = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
    });
}
