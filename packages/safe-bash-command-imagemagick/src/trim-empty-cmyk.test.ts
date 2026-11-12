import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: inspect inks and convert them independently
// so an RGBA-only replacement cannot hide a missing CMYK working plane.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { background: "#123456", after: [], format: "cmyka", expected: "eea100e700" },
        { background: "#123456", after: ["-alpha", "opaque"], format: "rgba", expected: "020918ff" },
        { background: "#123456", after: ["-colorspace", "sRGB"], format: "rgba", expected: "02091800" },
        { background: "#123456", after: ["-format", "%[pixel:u]"], format: "info", expected: "cmyka(238.425,160.902,0,231.27,0)" },
        { background: "white", after: ["-alpha", "opaque"], format: "rgba", expected: "ffffffff" },
        { background: "black", after: [], format: "cmyka", expected: "000000ff00" },
        { background: "gray(50%)", after: [], format: "cmyka", expected: "0000008000" },
        { background: "cmyk(20%,40%,60%,10%)", after: [], format: "cmyka", expected: "3366991a00" },
    ])(`${mode}: keeps empty trim inks for $background ($after, $format)`, async ({ background, after, format, expected }) => {
        const argv = ["-size", "3x2", "xc:#123456", "-colorspace", "CMYK", "-background", background,
            "-format", "%wx%h|%g", "-trim", "-write", "info:/geometry", ...after, ...(format === "info" ? [] : ["-depth", "8"]), `${format}:/out`];
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("magick: geometry does not contain image '#123456'\n");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        const geometry = mode === "command" || mode === "retained" ? await filesystem.readFile("/geometry") : files.get("/geometry")!;
        expect(new TextDecoder().decode(geometry)).toBe("1x1|3x2-1-1");
        expect(format === "info" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(expected);
    });
}
