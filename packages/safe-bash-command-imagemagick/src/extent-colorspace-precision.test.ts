import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: covered pixel followed by untouched padding.
for (const route of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "Lab", compose: "Over", background: "#bd355670", relabel: false, depth: "16", expected: "0000743192b6b8800000ffffffff7070" },
        { space: "Lab", compose: "Over", background: "#bd355670", relabel: true, depth: "16", expected: "5f1b6a0a6280b880bdbd353556567070" },
        { space: "HSL", compose: "Multiply", background: "#123456789abc", relabel: false, depth: "16", expected: "76d4547942faffffbcf095b77888ffff" },
        { space: "Lab", compose: "Copy", background: "#bd355670", relabel: false, depth: "16", expected: "12153434565680800000ffffffff7070" },
        { space: "HSL", compose: "Copy", background: "#123456789abc", relabel: false, depth: "16", expected: "1212343456568080bcf095b77888ffff" },
        { space: "sRGB", compose: "Over", background: "#bd355670", relabel: false, depth: "16", expected: "462d34825656b880bdbd353556567070" },
        { space: "Lab", compose: "Over", background: "#bd355670", relabel: false, depth: "8", expected: "007492b800ffff70" },
    ])(`${route}: extent $compose in $space at depth $depth (relabel=$relabel)`, async ({ space, compose, background, relabel, depth, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:#12345680", "-colorspace", space, "-background", background,
            "-compose", compose, "-extent", "2x1", ...(relabel ? ["-set", "colorspace", "sRGB"] : []),
            "-depth", depth, "-endian", "MSB", "rgba:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = route === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : route === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, route === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stderr: "" });
        const output = route === "command" || route === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
