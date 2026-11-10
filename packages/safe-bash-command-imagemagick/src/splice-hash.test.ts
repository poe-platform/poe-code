import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for these exact PPM bytes.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (i * 53 + 9) % 256))]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["-splice", "2x1+1+1#", 72, "bd725b47abbc653a2b991e18a4d098a48eb4111bd5cff852b9a87e706022c6cc"],
        ["-splice", "2x1+1+1", 72, "bd725b47abbc653a2b991e18a4d098a48eb4111bd5cff852b9a87e706022c6cc"],
        ["-chop", "2x1+1+1#", 12, "8a52ad25238e7b7d6ecb1908d2103cf98c3ab238674649aa4431040bfc79a075"],
    ] as const)(`preserves native dimensions and offsets for %s %s (${mode})`, async (operation, geometry, length, hash) => {
        const files = new Map([["in.ppm", input], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", operation, geometry, "-depth", "8", "rgb:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(output).toHaveLength(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
