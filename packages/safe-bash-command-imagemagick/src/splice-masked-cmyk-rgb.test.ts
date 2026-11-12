import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete native ImageMagick 7.1.2-35 Q16-HDRI byte streams.
const region = ["-region", "1x1+1+1"];
const cases = [
    { name: "region to sRGB", mask: region, output: ["-colorspace", "sRGB"], format: "rgba", expected: "4080c080ffffff004080c0804080c080ffffff004080c080" },
    { name: "region to opaque sRGB", mask: region, output: ["-alpha", "Off", "-colorspace", "sRGB"], format: "rgba", expected: "4080c0ffffffffff4080c0ff4080c0ffffffffff4080c0ff" },
    { name: "write mask to sRGB", mask: ["-write-mask", "xc:black"], output: ["-colorspace", "sRGB"], format: "rgba", expected: "4080c080ffffff004080c0804080c080ffffff004080c080" },
    { name: "region ink channels", mask: region, output: [], format: "cmyka", expected: "aa55003f800000000000aa55003f80aa55003f800000000000aa55003f80" },
    { name: "region black channel", mask: region, output: ["-channel", "K", "-separate"], format: "gray", expected: "3f003f3f003f" },
    { name: "unmasked background", mask: [], output: ["-colorspace", "sRGB"], format: "rgba", expected: "4080c080040d04404080c0804080c080040d04404080c080" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: masked CMYK splice preserves $name`, async ({ mask, output, format, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argv = ["-size", "2x2", "xc:#4080c080", "-alpha", "On", "-colorspace", "CMYK", "-background", "#20402040",
            ...mask, "-splice", "1x0+1+0", "+region", "+write-mask", "+read-mask", ...output, "-depth", "8", `${format}:/out`];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
