import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: nonconstant Meta0 from a black-white gradient.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const dimensions of [false, true]) it.each([
        { rotation: [], size: "3x2", hex: "000000ffffff" },
        { rotation: ["-rotate", "90"], size: "2x3", hex: "ff00ff00ff00" },
        { rotation: ["-rotate", "37"], size: "5x6", hex: "00".repeat(30) },
    ])(`${mode}: extracts Meta0 after $rotation (dimensions=${dimensions})`, async ({ rotation, size, hex }) => {
        const args = ["-size", "3x2", "xc:black", "-duplicate", "3", "gradient:black-white", "-combine", ...rotation,
            "-channel", "Meta0", "-separate", "+channel", ...(dimensions ? ["-format", "%wx%h", "info:-"] : ["-depth", "8", "gray:-"])];
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes
            : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString(dimensions ? "utf8" : "hex")).toBe(dimensions ? size : hex);
    });
}
