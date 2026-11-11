import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-31 Q16-HDRI, C,M,Y,K,A or R,G,B,A bytes at depth 8.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { channel: [], operation: ["-ordered-dither", "o2x2,3,4,5,6,7"], output: "cmyka", expected: "aa00668080" },
        { channel: ["-channel", "K,A"], operation: ["-ordered-dither", "o2x2,3,4,5,6,7"], output: "cmyka", expected: "ac006c5580" },
        { channel: ["-channel", "All,!Alpha"], operation: ["-ordered-dither", "o2x2,3,4,5,6,7"], output: "cmyka", expected: "aa00668080" },
        { channel: [], operation: ["-ordered-dither", "o2x2"], output: "cmyka", expected: "ff00ffffff" },
        { channel: [], operation: ["-ordered-dither", "o2x2"], output: "rgba", expected: "000000ff" },
        { channel: ["-channel", "Default"], operation: ["-ordered-dither", "o2x2"], output: "cmyka", expected: "ff00ffffff" },
        { channel: ["-channel", "Default"], operation: ["-ordered-dither", "o2x2"], output: "rgba", expected: "000000ff" },
        { channel: ["-channel", "K"], operation: ["-ordered-dither", "o2x2"], output: "cmyka", expected: "ac006cff80" },
        { channel: ["-channel", "K"], operation: ["-ordered-dither", "o2x2"], output: "rgba", expected: "00000080" },
        { channel: ["-channel", "C"], operation: ["-ordered-dither", "o2x2"], output: "cmyka", expected: "ff006c5f80" },
        { channel: ["-channel", "C"], operation: ["-ordered-dither", "o2x2"], output: "rgba", expected: "00a05c80" },
        { channel: ["-channel", "CMY"], operation: ["-ordered-dither", "o2x2"], output: "cmyka", expected: "ff00ff5f80" },
        { channel: ["-channel", "CMY"], operation: ["-ordered-dither", "o2x2"], output: "rgba", expected: "00a00080" },
        { channel: ["-channel", "A"], operation: ["-ordered-dither", "o2x2"], output: "cmyka", expected: "ac006c5fff" },
        { channel: ["-channel", "A"], operation: ["-ordered-dither", "o2x2"], output: "rgba", expected: "34a05cff" },
        { channel: [], operation: [], output: "cmyka", expected: "ac006c5f80" },
        { channel: [], operation: [], output: "rgba", expected: "34a05c80" },
    ])(`${mode}: CMYK ordered dither $operation with $channel into $output`, async ({ channel, operation, output, expected }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = ["xc:#34a05c80", "-colorspace", "CMYK", ...channel, ...operation,
            "+channel", ...(output === "rgba" ? ["-colorspace", "sRGB"] : []), "-depth", "8", `${output}:out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
