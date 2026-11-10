import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompareCli, runCompareCliSync, runMagickCli, runMagickCliSync } from "./index.js";

const input = encodeImage({
    width: 3, height: 2, data: Uint8Array.from([
        255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255,
        255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255
    ]),
    format: "tiff", space: "srgb", channels: 3, depth: "uchar", density: 72,
    hasAlpha: false, orientation: 6
}, { format: "tiff" }).data;

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { input: "/RightTop.tif", options: [], geometry: "1x1+8+8", after: [], format: "%wx%h %g %[orientation];", expected: "1x1 3x2-1-1 RightTop;" },
        { input: "/RightTop.tif", options: [], geometry: "1x1+8+8", after: ["-auto-orient"], format: "%wx%h %g %[orientation];", expected: "1x1 2x3+2-1 TopLeft;" },
        { input: "/RightTop.tif", options: [], geometry: "2x1+0+0", after: ["-auto-orient"], format: "%wx%h %g %[orientation];", expected: "1x2 2x3+1+0 TopLeft;" },
        { input: "/RightTop.tif[1x1+8+8]", options: [], geometry: "", after: ["-auto-orient"], format: "%wx%h %g %[orientation];", expected: "1x1 2x3+2-1 TopLeft;" },
        ...["1x1+8+8", "1x1+0+0"].flatMap(geometry => [
            { input: "xc:red", options: ["-set", "label", "first"], geometry, after: [], format: "%l;", expected: "first;" },
            { input: "xc:red", options: ["-set", "comment", "note"], geometry, after: [], format: "%[comment];", expected: "note;" },
            { input: "xc:red", options: ["-set", "dispose", "Previous"], geometry, after: [], format: "%D;", expected: "Previous;" },
            { input: "xc:red", options: ["-set", "profiletag", "abc"], geometry, after: [], format: "%[profiletag];", expected: "abc;" },
            { input: "xc:red", options: ["-set", "delay", "14"], geometry, after: [], format: "%T;", expected: "14;" }
        ])
    ])(`preserves $format after $geometry $after (${mode})`, async test => {
        const files = new Map([["/RightTop.tif", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = [test.input, ...test.options, ...(test.geometry ? ["-crop", test.geometry] : []), ...test.after, "-format", test.format, "info:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(test.geometry === "1x1+8+8"
            ? "magick: geometry does not contain image '1x1+8+8'\n"
            : test.geometry === "" ? "magick: geometry does not contain image '/RightTop.tif'\n" : "");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(test.expected);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`preserves missed-crop metadata in compare (${mode})`, async () => {
        const files = new Map([["/RightTop.tif", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/RightTop.tif", input);
        const args = ["/RightTop.tif", "/RightTop.tif", "-set", "label", "first", "-set", "comment", "note",
            "-set", "profiletag", "abc", "-crop", "1x1+8+8", "-auto-orient",
            "-format", "%wx%h %g %[orientation];%l;%[comment];%[profiletag];", "null:"];
        const result = mode === "sync" ? runCompareCliSync(args, files)
            : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("1x1 2x3+2-1 TopLeft;first;note;abc;");
    });
}
