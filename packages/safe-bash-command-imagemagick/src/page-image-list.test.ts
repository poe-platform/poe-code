import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const setting of [["-page"], ["-set", "option:page"]]) {
        it.each(["2x2+1+1", "%[fx:n]x2+1+1", "%[fx:u[1].w/3]x2+1+1"])(
            `${mode}, ${setting.join(" ")}: %s uses the current image list`, async (geometry) => {
            const input = Buffer.concat([Buffer.from("P6\n6 4\n255\n"), Buffer.from(Array.from({ length: 72 }, (_, i) => i))]);
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const args = ["/in.ppm", "+clone", ...setting, geometry, "-format", "%wx%h|%g\n", "info:"];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stdout: "6x4|2x2+1+1\n6x4|2x2+1+1\n", stderr: "" });
        });
    }
}
