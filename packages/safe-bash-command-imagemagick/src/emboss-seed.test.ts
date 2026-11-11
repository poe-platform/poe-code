import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGB8 pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { seed: "3", method: "random", expected: "000000000000558080ffffffffffffff00000000000080aa80aaaa" },
        { seed: "4", method: "random", expected: "000000000000006666ffffffffffffff0000000000009999003366" },
        { seed: "3", method: "edge", expected: "000000000000000000ffffffffffffff000000000000ffff00ffff" },
    ])(`${mode}: emboss seed=$seed with $method virtual pixels`, async ({ seed, method, expected }) => {
        for (let repeat = 0; repeat < 3; repeat++) {
            const input = Buffer.from("50360a3320330a3235350a03142434445464758595a5b5c5d6e6f606162637475767778798a8", "hex");
            const argv = ["/in.ppm", "-seed", seed, "-virtual-pixel", method, "-emboss", "1x1", "-depth", "8",
                mode === "command" ? "rgb:-" : "rgb:/out"];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            await fs.writeFile("/in.ppm", input);
            const args = createCommandArguments(argv);
            let stderr = "", stdout = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
            expect(hex).toBe(expected);
        }
    });
}
