import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, -limit thread 1 -seed 42:
// RGB fixture -> CMYK -> virtual pixel -> warp -> K or sRGB, exported at depth 8.
const cases = [
    { operation: "-spread", amount: "2", virtualPixel: "gray", output: "gray", expected: "808032561f54464880403680268052" },
    { operation: "-spread", amount: "2", virtualPixel: "white", output: "gray", expected: "ffff57561f77464eff4036ff26ff52" },
    { operation: "-spread", amount: "2", virtualPixel: "black", output: "gray", expected: "00000d561f31464100403600260052" },
    { operation: "-spread", amount: "2", virtualPixel: "edge", output: "gray", expected: "374013561f4346451d403629262052" },
    { operation: "-spread", amount: "2", virtualPixel: "gray", output: "rgb", expected: "404040404040b0755d4f2ba9df6d6d931c69ae148141aba7404040b59f848279974040402d73b7404040448aad" },
    { operation: "-implode", amount: "3", virtualPixel: "gray", output: "gray", expected: "373e454c43142f8080722943808065" },
    { operation: "-implode", amount: "3", virtualPixel: "white", output: "gray", expected: "373e454c43142fffffca2961ffffc7" },
    { operation: "-implode", amount: "3", virtualPixel: "black", output: "gray", expected: "373e454c43142f00001a2926000004" },
    { operation: "-implode", amount: "3", virtualPixel: "edge", output: "gray", expected: "373e454c43142f3743532931291111" },
    { operation: "-implode", amount: "3", virtualPixel: "gray", output: "rgb", expected: "0000c8112fc1225eba338db344bcac55eba5497baf404040404040535c55aad682917b704040404040405f514a" }
];

for (const depth of [8, 16]) {
    const samples = Array.from({ length: 15 }, (_, i) => [i * 17, i * 47 % 256, 200 - i * 7]).flat();
    const input = Buffer.concat([
        Buffer.from(`P6\n5 3\n${2 ** depth - 1}\n`),
        Buffer.from(depth === 16 ? samples.flatMap(value => [value, value]) : samples)
    ]);
    for (const mode of ["command", "retained", "buffered", "sync"] as const)
    it.each(cases)(`${mode}, depth ${depth}: $operation with $virtualPixel virtual pixels to $output`, async ({ operation, amount, virtualPixel, output, expected }) => {
        const argv = ["-limit", "thread", "1", "-seed", "42", "in.ppm", "-colorspace", "CMYK",
            "-virtual-pixel", virtualPixel, operation, amount,
            ...(output === "gray" ? ["-channel", "K", "-separate"] : ["-colorspace", "sRGB"]),
            "-depth", "8", `${output}:-`];
        const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
        await fs.writeFile("/in.ppm", input);
        const files = new Map([["in.ppm", input]]);
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
        expect(bytes.toString("hex")).toBe(expected);
    });
}
