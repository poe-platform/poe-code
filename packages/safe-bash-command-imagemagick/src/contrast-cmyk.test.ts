import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including untouched round-trip controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-contrast"], format: "rgba", expected: "2da05880" },
        { options: ["+contrast"], format: "rgba", expected: "3ba06080" },
        { options: ["-contrast"], format: "cmyka", expected: "b700735f80" },
        { options: ["+contrast"], format: "cmyka", expected: "a100655f80" },
        { options: [], format: "rgba", expected: "34a05c80" },
    ])(`${mode}: CMYK $options to $format`, async ({ options, format, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#34a05c80", "-colorspace", "CMYK", ...options,
            ...(format === "rgba" ? ["-colorspace", "sRGB"] : []), "-depth", "8", `${format}:/out`];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
