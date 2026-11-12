import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI bytes, including decoded PNG32 output.
for (const backend of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "white CMYK inks", background: "white", output: "cmyka", expected: "e4b27f55ff" },
        { name: "black CMYK inks", background: "black", output: "cmyka", expected: "65330055ff" },
        { name: "black separation", background: "white", options: ["-channel", "K", "-separate"], output: "gray", expected: "55" },
        { name: "converted RGB", background: "white", options: ["-colorspace", "sRGB"], output: "rgba", expected: "123455ff" },
        { name: "saved PNG", background: "white", options: ["-colorspace", "sRGB"], output: "PNG32", expected: "123455ff" },
        { name: "opaque CMYK control", background: "white", color: "#123456ff", options: ["-colorspace", "sRGB"], output: "rgba", expected: "123456ff" },
        { name: "sRGB control", background: "white", space: "sRGB", options: ["-colorspace", "sRGB"], output: "rgba", expected: "8899aaff" },
    ])(`${backend}: $name`, async ({ background, options = [], output, expected, color = "#12345680", space = "CMYK" }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [`xc:${color}`, "-colorspace", space, "-background", background, "-alpha", "Remove", ...options, "-depth", "8", `${output}:-`];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : backend === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, backend === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(output === "PNG32" ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
    });
}
