import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const inputs = ["204080", "905030", "7010b0", "807040", "40a0b0", "2070c0"].map(color => `xc:#${color}`);
// Native ImageMagick 7.1.2-35 Q16-HDRI: CMYK keeps five planes only with alpha enabled.
const cases = [
    { count: 4, alpha: "on", output: "cmyka", expected: "845dba20ff" },
    { count: 4, alpha: "off", output: "rgba", expected: "6c8d3dff" },
    { count: 5, alpha: "on", output: "cmyka", expected: "845dba2033" },
    { count: 5, alpha: "on", output: "meta0", expected: "00" },
    { count: 5, alpha: "off", output: "rgba", expected: "845dba20" },
    { count: 5, alpha: "off", output: "meta0", expected: "33" },
    { count: 6, alpha: "on", output: "rgba", expected: "845dba20" },
    { count: 6, alpha: "on", output: "meta0", expected: "33" },
    { count: 6, alpha: "off", output: "rgba", expected: "845dba20" },
    { count: 6, alpha: "off", output: "meta0", expected: "33" },
    { count: 5, alpha: "on", output: "cmyka", expected: "845dba2033", size: "513x2" },
    { count: 6, alpha: "on", output: "meta0", expected: "33", size: "513x2" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: $count CMYK operands with alpha $alpha into $output ($size)`, async ({ count, alpha, output, expected, size = "1x1" }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const argv = ["-size", size, ...inputs.slice(0, count), "-colorspace", "CMYK", "-alpha", alpha, "-combine",
            ...(output === "meta0" ? ["-channel", "Meta0", "-separate", "+channel"] : output === "rgba" ? ["-colorspace", "sRGB"] : []),
            "-depth", "8", `${output === "meta0" ? "gray" : output}:out`];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        const pixel = Buffer.from(expected, "hex");
        expect(bytes.length).toBe(pixel.length * (size === "1x1" ? 1 : 513 * 2));
        expect(Buffer.from(bytes).toString("hex")).toBe(expected.repeat(bytes.length / pixel.length));
    });
}
