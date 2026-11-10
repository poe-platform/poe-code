import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: clamp at composition, before later arithmetic.
const cases = [
    { name: "clamps above-range red", color: "#c04020", divide: false, expected: "ff40200000ff" },
    { name: "divides the clamped working sample", color: "#c04020", divide: true, expected: "8040200000ff" },
    { name: "preserves in-range red", color: "#504020", divide: false, expected: "a040200000ff" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["+smush", "-smush"])
it.each(cases)(`${mode} ${direction}: $name`, async ({ color, divide, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["(", `xc:${color}`, "-channel", "R", "-evaluate", "Multiply", "2", "+channel", ")",
        "xc:blue", "-background", "none", direction, "0",
        ...(divide ? ["-channel", "R", "-evaluate", "Divide", "2", "+channel"] : []),
        "-depth", "8", "rgb:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
