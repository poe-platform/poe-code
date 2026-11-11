import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
// ImageMagick 7.1.2-35 Q16-HDRI export references, with channel and identity controls.
const cases = [
    { name: "calculated 16-bit samples", options: ["-bilateral-blur", "3x3+64+1", "-depth", "16"], expected: "14501fa32af6501462df75aa" },
    { name: "8-bit output", options: ["-bilateral-blur", "3x3+64+1", "-depth", "8"], expected: "14202b506275" },
    { name: "unfiltered 16-bit output", options: ["-depth", "16"], expected: "0a0a14141e1e5a5a6e6e8282" },
    { name: "selected red channel", options: ["-channel", "R", "-bilateral-blur", "3x3+64+1", "+channel", "-depth", "16"], expected: "145014141e1e50146e6e8282" },
    { name: "fractional input through an identity window", options: ["-evaluate", "Divide", "3", "-bilateral-blur", "1x1", "-depth", "16"], expected: "035906b10a0a1e1e24cf2b81" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(cases)(`retains bilateral blur precision: $name (${mode})`, async ({ options, expected }) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", ...options, "-endian", "MSB", "rgb:/out.rgb"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += chunk; } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    if ("stderr" in result) expect(result.stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
