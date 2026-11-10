import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { geometry: "3x3+150%", window: "3x3+150%", valid: true },
        { geometry: "%[option:win]", window: "3x3+150%", valid: true },
        { geometry: "unknown", window: "3x3+150%", valid: false },
        { geometry: "%[option:win]", window: "unknown", valid: false },
        { geometry: "%[option:win]", window: "1001x3+150%", valid: false },
    ])(`validates expanded mean-shift geometry $geometry ($window) via ${mode}`, async ({ geometry, window, valid }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", original);
        const args = ["xc:#10203012", "xc:#8090a093", "xc:#a0b0d0b5", "+append",
            "-set", "option:win", window, "-mean-shift", geometry,
            "-set", "option:win", "invalid", "-depth", "8", "rgba:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const diagnostic = String("stderr" in result ? result.stderr : stderr);
        expect(result.exitCode, diagnostic).toBe(valid ? 0 : 1);
        expect(diagnostic.toLowerCase()).toEqual(valid ? "" : expect.stringContaining("mean-shift"));
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        // Native ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output.
        expect(Buffer.from(output).toString("hex")).toBe(valid ? "2636465f708093b39aaac6e1" : "4b454550");
    });
}
