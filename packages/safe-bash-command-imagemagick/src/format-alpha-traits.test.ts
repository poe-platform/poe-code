import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reports retained alpha in the storage description.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  for (const transform of [[], ["-blue-shift", "1"]]) {
    it.each([
        { alpha: "deactivate", trait: "Copy", channels: "srgba 4.0", pixel: "srgba(64,128,192,0.501961)", opacity: "0.501961" },
        { alpha: "discrete", trait: "Update", channels: "srgba 4.0", pixel: "srgba(64,128,192,0.501961)", opacity: "0.501961" },
        { alpha: "on", trait: "Blend", channels: "srgba 4.0", pixel: "srgba(64,128,192,0.501961)", opacity: "0.501961" },
        { alpha: "off", trait: "Undefined", channels: "srgb  3.0", pixel: "srgb(64,128,192)", opacity: "0.25098" }
    ])(`${mode}: alpha $alpha trait after ${transform.join(" ")}`, async ({ alpha, trait, channels, pixel, opacity }) => {
        if (transform.length) {
            pixel = pixel.replace("64,128,192", "128,144,160");
            opacity = "0.501961";
        }
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#4080c080", "-alpha", alpha, ...transform, "-format", "%A|%[channels]|%[pixel:p{0,0}]|%[fx:p{0,0}.a]", "info:/out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(`${trait}|${channels}|${pixel}|${opacity}`);
    });
}
}
