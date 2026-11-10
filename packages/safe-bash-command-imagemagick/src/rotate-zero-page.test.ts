import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 preserves offsets on zero-sized page axes.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["0x0-4-3", "180", "info", "3x2 0x0 -4 -3"],
        ["0x8-4+3", "270", "info", "2x3 8x0 +3 -4"],
        ["9x0+4-3", "90", "info", "2x3 0x9 -3 +4"],
        ["9x8+4+3", "90", "info", "2x3 8x9 +3 +4"],
        ["0x0-4-3", "180", "rgb", "a5790289ef46443a8fd1209f62ee52c27dc7af4816534231792b63dcb6e77b6d"],
    ])(`rotates page %s by %s into %s (${mode})`, async (page, angle, format, expected) => {
        const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff804020c0ffee231337", "hex")]);
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", "-repage", page, "-rotate", angle,
            ...(format === "info" ? ["-format", "%wx%h %P %X %Y"] : ["-depth", "8"]), `${format}:/out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(format === "info" ? new TextDecoder().decode(output) : createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
