import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["3x1", "%[option:win]", "%[fx:w]x1", "bad", "%[option:invalid]"])(`expands local threshold window %s via ${mode}`, async geometry => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", original);
        const args = ["xc:#20709040", "xc:#804020a0", "xc:#a070a0ee", "+append",
            "-set", "option:win", "3x1", "-set", "option:invalid", "bad", "-lat", geometry, "-depth", "8", "rgba:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const invalid = geometry === "bad" || geometry === "%[option:invalid]";
        expect(result.exitCode, String("stderr" in result ? result.stderr : stderr)).toBe(invalid ? 1 : 0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        // Native ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output.
        expect(Buffer.from(output).toString("hex")).toBe(invalid ? "4b454550" : "00ffff00ff0000ffffffffff");
    });
}
