import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([true, false])(`requires an input before extent (beforeInput=%s, ${mode})`, async (beforeInput) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const input = ["-size", "4x3", "xc:#4080c080"], extent = ["-extent", "6x5"];
        const args = [...(beforeInput ? [...extent, ...input] : [...input, ...extent]), "-format", "%wx%h %W,%H,%X,%Y", "info:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(result.exitCode).toBe(beforeInput ? 1 : 0);
        if (beforeInput) expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-extent'");
        else expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(new TextDecoder().decode(output)).toBe(beforeInput ? "KEEP" : "6x5 6,5,+0,+0");
    });
}
