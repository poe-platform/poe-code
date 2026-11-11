import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: raw extraction starts a fresh page and zero-fills missing samples.
for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    it.each([
        { options: [], geometry: "3x2|3x2+0+0", samples: [10, 20, 30, 40, 50, 60] },
        { options: ["-extract", "2x1+1+1"], geometry: "2x1|2x1+0+0", samples: [50, 60] },
        { options: ["-extract", "1x1+9+9"], geometry: "1x1|1x1+0+0", samples: [0] },
        { options: ["-extract", "2x2+2+1"], geometry: "2x2|2x2+0+0", samples: [60, 0, 0, 0] },
        { options: ["-extract", "2x2-1-1"], geometry: "2x2|2x2+0+0", samples: [0, 0, 0, 10] },
        { options: ["-extract", "4x3+0+0"], geometry: "4x3|4x3+0+0", samples: [10, 20, 30, 0, 40, 50, 60, 0, 0, 0, 0, 0] },
        { options: ["-extract", "2x1"], geometry: "2x1|2x1+0+0", samples: [28, 42] },
        { options: ["-extract", "1x1+9+9", "+extract"], geometry: "3x2|3x2+0+0", samples: [10, 20, 30, 40, 50, 60] },
        { options: [], input: "/in.gray[2x1+1+1]", geometry: "2x1|2x1+0+0", samples: [50, 60] },
        { options: ["-extract", "1x1+9+9"], input: "gray:/in.gray[2x1+1+1]", geometry: "2x1|2x1+0+0", samples: [50, 60] },
        { options: ["-extract", "2x1+1+1"], depth: 16, geometry: "2x1|2x1+0+0", samples: [50, 60] },
    ])(`extracts raw gray in ${mode}: $options $input $depth`, async ({ options, input, depth = 8, geometry, samples }) => {
        const source = [10, 20, 30, 40, 50, 60];
        const files = new Map<string, Uint8Array>([["/in.gray", new Uint8Array(depth === 16 ? source.flatMap(value => [value, value]) : source)], ["/out.raw", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-size", "3x2", "-depth", String(depth), ...options, input ?? "gray:/in.gray", "-format", "%wx%h|%g", "-write", "info:", "-depth", "8", "gray:/out.raw"];
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(mode === "command" ? { ...result, stdout, stderr } : result).toMatchObject({ exitCode: 0, stdout: geometry, stderr: "" });
        expect([...(mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!)]).toEqual(samples);
    });
}
