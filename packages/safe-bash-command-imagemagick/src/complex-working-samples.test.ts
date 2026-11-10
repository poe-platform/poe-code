import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inputs = ["xc:#2070a031", "xc:#30906082", "xc:#60402060", "xc:#40108044"];
// ImageMagick 7.1.2-35 Q16-HDRI: real then imaginary RGBA8, including alpha.
const cases = [
    { space: "HSL", operation: "Add", expected: "314dff91ffff39c6" },
    { space: "Lab", operation: "Add", expected: "ff006291ff0072c6" },
    { space: "HSL", operation: "Conjugate", expected: "2070a03100000000" },
    { space: "HSL", operation: undefined, expected: "2070a03130906082" },
    { space: "Lab", operation: undefined, expected: "2070a03130906082" },
    { space: "sRGB", operation: "Add", expected: "80b0c09170a0e0c6" }
];

for (const mode of ["buffered", "sync", "retained", "command"])
it.each(cases)(`${mode}: $space $operation updates both working images`, async ({ space, operation, expected }) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const argv = [...inputs.slice(0, operation ? 4 : 2), "-colorspace", space,
        ...(operation ? ["-complex", operation] : []), "+channel", "-colorspace", "sRGB", "+append", "-depth", "8", "rgba:/out"];
    const arguments_ = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});

it.each([-120, -20, 20, 120, 220])("wraps HSL hue %s%% after arithmetic", hue => {
    const files = new Map<string, Uint8Array>();
    const result = runConvertCliSync(["xc:#30906082", "-colorspace", "HSL", "-channel", "R",
        "-evaluate", "Set", `${hue}%`, "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], files);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(files.get("/out")!).toString("hex")).toBe(hue < 0 ? "7d309082" : "7d903082");
});
