import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI selects #808080 in both reported expanded ranges.
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { settings: [], range: "black-white", expected: "ff" },
        { settings: ["-set", "option:bounds", "black-white"], range: "%[bounds]", expected: "ff" },
        { settings: ["-set", "option:bounds", "black-white"], range: "%[option:bounds]", expected: "ff" },
        { settings: ["-set", "bounds", "black-white"], range: "%[bounds]", expected: "ff" },
        { settings: [], range: "black-rgb(%[fx:255],255,255)", expected: "ff" },
        { settings: [], range: "black-rgb(%[fx:127],255,255)", expected: "00" },
        { settings: ["xc:#808080"], range: "black-rgb(%[fx:255*(1-t)],255,255)", expected: "ff00" },
    ])(`${mode}: selects pixels using $range with $settings`, async ({ settings, range, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#808080", ...settings, "-color-threshold", range, "+append", "-depth", "8", "gray:/out"];
        let stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}

for (const range of ["%[bounds]", "black-rgb(%[fx:255],255,255)"]) {
    it(`mogrify: selects pixels using ${range}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.pgm", Buffer.concat([Buffer.from("P5\n1 1\n255\n"), Buffer.from([128])]));
        const result = await runMogrifyCli(["-set", "option:bounds", "black-white", "-color-threshold", range, "input.pgm"], { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect([...decodeImage(await fs.readFile("/input.pgm")).data]).toEqual([255, 255, 255, 255]);
    });
}
