import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#345caa80, selected channel,
// sigmoidal contrast 5x40%, then sRGB raw RGBA (16-bit samples are MSB first).
const cases = [
    { space: "Gray", option: "-sigmoidal-contrast", channel: "R", expected: ["61616180", "61b061b061b08080"] },
    { space: "Gray", option: "-sigmoidal-contrast", channel: "G", expected: ["59595980", "5979597959798080"] },
    { space: "Gray", option: "-sigmoidal-contrast", channel: "B", expected: ["59595980", "5979597959798080"] },
    { space: "Gray", option: "-sigmoidal-contrast", channel: "RGB", expected: ["61616180", "61b061b061b08080"] },
    { space: "Gray", option: "-sigmoidal-contrast", channel: "A", expected: ["5959599b", "5979597959799b4c"] },
    { space: "Gray", option: "+sigmoidal-contrast", channel: "R", expected: ["54545480", "53dd53dd53dd8080"] },
    { space: "Gray", option: "+sigmoidal-contrast", channel: "G", expected: ["59595980", "5979597959798080"] },
    { space: "Gray", option: "+sigmoidal-contrast", channel: "B", expected: ["59595980", "5979597959798080"] },
    { space: "Gray", option: "+sigmoidal-contrast", channel: "RGB", expected: ["54545480", "53dd53dd53dd8080"] },
    { space: "Gray", option: "+sigmoidal-contrast", channel: "A", expected: ["5959596e", "5979597959796e19"] },
    { space: "LinearGray", option: "-sigmoidal-contrast", channel: "R", expected: ["54545480", "53d753d753d78080"] },
    { space: "LinearGray", option: "-sigmoidal-contrast", channel: "G", expected: ["5e5e5e80", "5ebd5ebd5ebd8080"] },
    { space: "LinearGray", option: "-sigmoidal-contrast", channel: "B", expected: ["5e5e5e80", "5ebd5ebd5ebd8080"] },
    { space: "LinearGray", option: "-sigmoidal-contrast", channel: "RGB", expected: ["54545480", "53d753d753d78080"] },
    { space: "LinearGray", option: "-sigmoidal-contrast", channel: "A", expected: ["5e5e5e9b", "5ebd5ebd5ebd9b4c"] },
    { space: "LinearGray", option: "+sigmoidal-contrast", channel: "R", expected: ["68686880", "6894689468948080"] },
    { space: "LinearGray", option: "+sigmoidal-contrast", channel: "G", expected: ["5e5e5e80", "5ebd5ebd5ebd8080"] },
    { space: "LinearGray", option: "+sigmoidal-contrast", channel: "B", expected: ["5e5e5e80", "5ebd5ebd5ebd8080"] },
    { space: "LinearGray", option: "+sigmoidal-contrast", channel: "RGB", expected: ["68686880", "6894689468948080"] },
    { space: "LinearGray", option: "+sigmoidal-contrast", channel: "A", expected: ["5e5e5e6e", "5ebd5ebd5ebd6e19"] },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [index, depth] of [8, 16].entries()) {
        it.each(cases)(`${mode}, depth ${depth}: $space $option with $channel`, async ({ space, option, channel, expected }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const argv = ["xc:#345caa80", "-colorspace", space, "-channel", channel, option, "5x40%",
                "+channel", "-colorspace", "sRGB", "-depth", String(depth), "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(stdout)
                : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected[index]);
        });
    }
}
