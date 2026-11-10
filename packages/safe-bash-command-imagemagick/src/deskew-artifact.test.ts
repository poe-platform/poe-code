import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const reset of [false, true]) {
    it.each(["buffered", "retained", "sync", "command"])(`exposes the deskew artifact after property reset=${reset} (%s)`, async mode => {
        const input = readFileSync(new URL("./fixtures/deskew-edge-stripes.png", import.meta.url));
        const files = new Map([["/stripes.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/stripes.png", input);
        const args = ["/stripes.png", "-deskew", "40%", ...(reset ? ["+set", "deskew:angle"] : []),
            "-format", "%wx%h:%[deskew:angle]:%[artifact:deskew:angle]", "info:"];
        let stdout = "", stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stdout).toBe("68x39:-4.4671590613892729:-4.4671590613892729");
        expect(stderr).toBe("");
    });
}
