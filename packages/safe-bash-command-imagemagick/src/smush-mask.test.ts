import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: first-frame masks survive smush with cleared samples.
const cases = [
    { name: "read-mask mean", first: ["-read-mask", "xc:white"], second: [], gap: "0", format: "%[fx:mean.r];", expected: "0;" },
    { name: "read-mask channels", first: ["-read-mask", "xc:white"], second: [], gap: "-1", format: "%wx%h %g %[colorspace] %[channels];", expected: "3x4 3x4+0+0 sRGB srgba 5.0;" },
    { name: "write-mask channels", first: ["-write-mask", "xc:white"], second: [], gap: "-1", format: "%wx%h %g %[colorspace] %[channels];", expected: "3x4 3x4+0+0 sRGB srgba 5.0;" },
    { name: "both mask channels", first: ["-read-mask", "xc:white", "-write-mask", "xc:white"], second: [], gap: "-1", format: "%[channels];", expected: "srgba 6.0;" },
    { name: "second-frame masks are not inherited", first: [], second: ["-read-mask", "xc:white", "-write-mask", "xc:white"], gap: "-1", format: "%[channels];", expected: "srgba 4.0;" },
    { name: "unmasked mean", first: [], second: [], gap: "0", format: "%[fx:mean.r];", expected: "0.818507;" },
    { name: "unmasked channels", first: [], second: [], gap: "-1", format: "%wx%h %g %[colorspace] %[channels];", expected: "3x4 3x4+0+0 sRGB srgba 4.0;" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: smush $name`, async ({ first, second, gap, format, expected }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", Buffer.from("KEEP"));
        const argv = ["(", "-size", "2x3", "xc:#8040c080", ...first, ")",
            "(", "-size", "3x2", "xc:#30905040", ...second, ")", "-smush", gap, "-format", format, "info:out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(bytes)).toBe(expected);
    });
}
