import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: adjacent floatmap records are separate scenes.
for (const fixture of [
    { format: "pfm", first: "50660a3220310a312e300a3e0000003f000000", second: "50660a3120310a312e300a3f400000", secondSize: "1x1" },
    { format: "phm", first: "50680a3220310a312e300a30003800", second: "50680a3220310a312e300a30003800", secondSize: "2x1" }
]) for (const mode of ["command", "sync", "buffered"] as const) {
    for (const sequence of [false, true]) for (const identify of [false, true]) {
        it(`reads ${fixture.format} scenes (${mode}, sequence=${sequence}, identify=${identify})`, async () => {
            const bytes = Buffer.from(fixture.first + (sequence ? fixture.second : ""), "hex");
            const path = `/in.${fixture.format}`, fs = new MemoryFileSystem();
            await fs.writeFile(path, bytes);
            const args = identify ? ["identify", "-format", "%s/%n:%wx%h;", path] : [path, "-format", "%s/%n:%wx%h;", "info:"];
            const argumentValues = createCommandArguments(args), files = new Map([[path, bytes]]);
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runMagickCli(args, files) : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe(sequence ? `0/2:2x1;1/2:${fixture.secondSize};` : "0/1:2x1;");
        });
    }
}
