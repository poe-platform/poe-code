import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: IHDR types and independently decoded RGBA16.
const ramp = [0, 16384, 32768, 49151, 65535].flatMap(value => [value, value, value, 65535]);
const cases = [
    ...[0, 4].map(color => ({ name: `8-bit gray type ${color}`, input: ["xc:gray50"], options: ["-define", `png:color-type=${color}`], color, depth: 8, samples: [127, 127, 127, 255] })),
    { name: "gray gradient", input: ["-size", "1x5", "gradient:black-white"], options: [], color: 0, samples: ramp },
    ...[0, 2, 4, 6].map(color => ({ name: `gray gradient type ${color}`, input: ["-size", "1x5", "gradient:black-white"], options: ["-define", `png:color-type=${color}`], color, samples: ramp })),
    { name: "explicit Gray", input: ["-size", "1x5", "gradient:black-white"], options: ["-colorspace", "Gray"], color: 0, samples: ramp },
    { name: "opaque RGB", input: ["xc:#123456789abc"], options: [], color: 2, samples: [0x1234, 0x5678, 0x9abc, 65535] },
    { name: "explicit RGB", input: ["xc:#123456789abc"], options: ["-define", "png:color-type=2"], color: 2, samples: [0x1234, 0x5678, 0x9abc, 65535] },
    { name: "low-bit color", input: ["xc:#123412351234"], options: [], color: 2, samples: [0x1234, 0x1235, 0x1234, 65535] },
    { name: "opaque RGBA", input: ["xc:#123456789abcffff"], options: [], color: 2, samples: [0x1234, 0x5678, 0x9abc, 65535] },
    { name: "low-bit alpha", input: ["xc:#123456789abcfffe"], options: [], color: 6, samples: [0x1234, 0x5678, 0x9abc, 65534] },
    { name: "gray canvas", input: ["xc:#123412341234"], options: [], color: 0, samples: [0x1234, 0x1234, 0x1234, 65535] }
].map(fixture => ({ depth: 16, ...fixture }));
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const write of [false, true])
it.each(cases)(`${mode}, write=${write}: $name`, async ({ input, options, color, samples, depth = 16 }) => {
    const argv = [...input, ...options, ...(write ? ["-write", "/output.png", "null:"] : ["png:-"])];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = write ? mode === "command" || mode === "retained" ? await fs.readFile("/output.png") : files.get("/output.png")!
        : mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect([bytes[24], bytes[25], bytes[28]]).toEqual([depth, color, 0]);
    const decoded = decodeImage(bytes);
    expect(Array.from(depth === 16 ? decoded.data16! : decoded.data)).toEqual(samples);
});
