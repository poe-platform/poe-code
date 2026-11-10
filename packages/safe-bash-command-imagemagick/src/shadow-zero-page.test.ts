import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Reference output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "filesystem", "map", "sync"] as const) {
    it.each([
        ["-1-2", "2x0-1-2"],
        ["-3-2", "0x0-3-2"],
        ["-2-1", "1x1-2-1"],
    ])(`preserves shadow page dimensions for %s (${mode})`, async (offset, page) => {
        const fs = createMemoryFileSystem();
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["-size", "3x2", "xc:#5080c080", "-background", "#d04020", "-shadow", `80x0${offset}`,
            "-format", "%wx%h %g %[channels];", "info:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(`3x2 ${page} srgba 4.0;`);
    });
}
