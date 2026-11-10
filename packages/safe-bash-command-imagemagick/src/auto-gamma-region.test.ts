import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -size 4x3 -depth 8 rgba:seed.rgba -strip PNG32:input.png.
// Seed: 11406f85cdfc2b0189b8e77d4574a3f901305f75bdec1bf179a8d76d356493e9f1204f65addc0be16998c75d255483d9.
// References decoded from native PNG32 output using -depth 8 rgba:-.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAH0lEQVQI12MWdMhvPXrny35lq0u1jBIGu5k+oAEMAQA3FSVR0d/4TgAAAABJRU5ErkJggg==", "base64");
const cases = [
    {
        name: "rectangular region",
        options: ["-region", "2x2+1+0", "-auto-gamma", "+region"],
        expected: "0a254185cbfc280185b5e6794574a3f900172e75bbeb18f075a5d569346291e9600c1f65a8d60be12435455d23507dd9",
    },
    {
        name: "RGB region",
        options: ["-channel", "RGB", "-region", "2x2+1+0", "-auto-gamma", "+region"],
        expected: "0c244385d4fc310197b0e97d4574a3f901163175c6ea20f1889fda6d356291e9620c2165a9d60be12735475d254f7ed9",
    },
    {
        name: "red region",
        options: ["-channel", "R", "-region", "2x2+1+0", "-auto-gamma", "+region"],
        expected: "0c406f85d4fc2b0197b8e77d4574a3f901305f75c6ec1bf188a8d76d356493e962204f65a9dc0be12798c75d255483d9",
    },
    {
        name: "alpha-only region",
        options: ["-channel", "A", "-region", "2x2+1+0", "-auto-gamma", "+region"],
        expected: "11406f85cdfc2b0189b8e77d4574a3f901305f75bdec1bf179a8d76d356493e9f1204f65addc0be16998c75d255483d9",
    },
    {
        name: "disabled alpha region",
        options: ["-alpha", "off", "-region", "2x2+1+0", "-auto-gamma", "+region"],
        expected: "11406fffcffc2eff8dbae8ff4574a3ff01305fffbfed1eff7dabd9ff356493fff1204fffaddc0bff6998c7ff255483ff",
    },
    {
        name: "unscoped control",
        options: ["-auto-gamma"],
        expected: "0f3c6b81cbfc280185b5e6794170a0f9012d5b71bbeb18f075a5d569316090e8f01d4b61aadb0ae06595c55922507fd7",
    },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`matches every native auto-gamma pixel for $name (${mode})`, async ({ options, expected }) => {
        const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const argv = ["input.png", ...options, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([4, 3]);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}
