import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["red=>blue", "red<=>blue", "red;green;blue"])(`rejects channel-fx before an image without overwriting output (${mode}): %s`, async expression => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const args = ["-channel-fx", expression, "xc:#12345678", "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stderr" in result) stderr += result.stderr;
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain("no images found");
        expect(stderr).toContain("-channel-fx");
        expect(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}

