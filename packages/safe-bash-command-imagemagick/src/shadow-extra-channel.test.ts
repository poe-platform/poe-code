import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI: shadow pads extra channels with zero without blurring them.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    for (const output of ["samples", "dimensions"]) it.each([
        { shadow: [], width: 2, height: 1, samples: [0, 255] },
        { shadow: ["-shadow", "80x0+0+0"], width: 2, height: 1, samples: [0, 255] },
        { shadow: ["-shadow", "80x1+0+0"], width: 6, height: 5,
            samples: Array.from({ length: 30 }, (_, index) => index === 15 ? 255 : 0) },
    ])(`preserves extra channel samples on the shadow canvas $shadow (${backend}, ${output})`, async ({ shadow, width, height, samples }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "2x1", "xc:black", "xc:black", "xc:black", "xc:white", "gradient:black-white",
            "-combine", ...shadow, "-channel", "10", "-separate", "+channel",
            ...(output === "dimensions" ? ["-format", "%wx%h", "info:/out"] : ["-depth", "8", "gray:/out"])];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const stored = backend === "retained" || backend === "command";
        const data = stored ? await filesystem.readFile("/out") : files.get("/out")!;
        if (output === "dimensions") expect(new TextDecoder().decode(data)).toBe(`${width}x${height}`);
        else expect(Array.from(data)).toEqual(samples);
    });
}
