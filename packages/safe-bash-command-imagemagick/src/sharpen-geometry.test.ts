import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["0,2", "0/2", "0x2", "0X2", "0:2"])(`matches native sharpen geometry %s (${mode})`, async geometry => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = ["xc:#50406080", "xc:#a08090c0", "+append", "-sharpen", geometry, "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        // ImageMagick 7.1.2-35 Q16-HDRI: colon does not separate radius and sigma.
        expect(Buffer.from(output).toString("hex")).toBe(geometry === "0:2" ? "2c234b6fad8a98d1" : "17123e67b28f9bd9");
    });
}
