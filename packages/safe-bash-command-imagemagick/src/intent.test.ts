import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const) {
    async function run(options: string[], format = "%[intent]") {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["xc:#2060b080", ...options, "-format", format, "info:/out"];
        let result;
        if (mode === "command") {
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const status = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        return { ...result, output: new TextDecoder().decode(mode === "map" || mode === "sync" ? files.get("/out") : await fs.readFile("/out")) };
    }

    it.each(["saturation", "Perceptual", "Relative", "Absolute", "Undefined", "pErCePtUaL"])(`preserves rendering intent spelling (${mode}): %s`, async intent => {
        expect(await run(["-intent", intent], "%[intent]|%[option:intent]")).toEqual({
            exitCode: 0, stdout: "", stderr: "", output: `${intent}|${intent}`
        });
    });

    it(`resets rendering intent (${mode})`, async () => {
        expect(await run(["-intent", "saturation", "+intent"])).toEqual({ exitCode: 0, stdout: "", stderr: "", output: "undefined" });
    });

    it.each(["xxx", "RelativeColorimetric"])(`rejects unknown intents without replacing output (${mode}): %s`, async intent => {
        const result = await run(["-intent", intent]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`unrecognized intent type '-intent' '${intent}'`);
        expect(result.output).toBe("KEEP");
    });

    it(`keeps an unset intent unknown (${mode})`, async () => {
        const result = await run([]);
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe("");
        expect(result.stderr).toContain("unknown image property '%[intent]'");
    });
}
