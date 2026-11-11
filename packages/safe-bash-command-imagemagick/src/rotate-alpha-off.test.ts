import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./rotate-alpha-off-fixtures.json" with { type: "json" };

// Native ImageMagick Q16-HDRI: raw RGBA8 and formatted pixels from the same rotation.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`preserves background alpha after rotation $options (${mode})`, async ({ options, hex, info }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = [...options, "-write", "rgba:/pixels", "-format", "%[channels]|%[hex:p{0,0}]|%[hex:p{3,2}]", "info:/info"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const pixels = mode === "command" || mode === "retained" ? await filesystem.readFile("/pixels") : files.get("/pixels")!;
        const text = mode === "command" || mode === "retained" ? await filesystem.readFile("/info") : files.get("/info")!;
        expect(Buffer.from(pixels).toString("hex")).toBe(hex);
        expect(Buffer.from(text).toString()).toBe(info);
    });
}
