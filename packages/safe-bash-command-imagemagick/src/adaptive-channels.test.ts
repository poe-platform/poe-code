import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA outputs at the requested depth.
const cases = [
    { depth: "8", selection: ["-channel", "R"], sharpen: "40607060879080b0", blur: "40607060789080b0" },
    { depth: "8", selection: ["-channel", "A"], sharpen: "40607060809080c2", blur: "406070608090809f" },
    { depth: "8", selection: ["-channel", "G"], sharpen: "40477060809580b0", blur: "40707060808a80b0" },
    { depth: "8", selection: ["-channel", "B"], sharpen: "40607060809082b0", blur: "4060706080907eb0" },
    { depth: "8", selection: ["-channel", "RGB"], sharpen: "1f476860879582b0", blur: "55707560788a7eb0" },
    { depth: "8", selection: ["-channel", "RGBA"], sharpen: "1f47684e879582c2", blur: "55707571788a7e9f" },
    { depth: "8", selection: ["-channel", "Default"], sharpen: "1f47684e879582c2", blur: "55707571788a7e9f" },
    { depth: "8", selection: ["-channel", "Sync"], sharpen: "40607060809080b0", blur: "40607060809080b0" },
    { depth: "8", selection: ["-channel", "R,A"], sharpen: "40607060879080c2", blur: "406070607890809f" },
    { depth: "8", selection: [], sharpen: "1f47684e879582c2", blur: "55707571788a7e9f" },
    { depth: "8", selection: ["-channel", "R", "+channel"], sharpen: "1f47684e879582c2", blur: "55707571788a7e9f" },
    { depth: "16", selection: ["-channel", "R"], sharpen: "123423453456456756786789789a89aba464abcdbcdecdef", blur: "123423453456456756786789789a89ab903eabcdbcdecdef" },
    { depth: "16", selection: ["-channel", "A"], sharpen: "123423453456456756786789789a89ab9abcabcdbcdedd78", blur: "123423453456456756786789789a89ab9abcabcdbcdebf5a" },
    { depth: "16", selection: ["-channel", "RGBA"], sharpen: "000000000ca035de56786789789a89aba464b575c686dd78", blur: "2a1c3b2d4c3e53fc56786789789a89ab903ea14fb260bf5a" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const operation of ["sharpen", "blur"] as const)
it.each(cases)(`honors adaptive ${operation} channels and edge response (${mode}, $depth-bit, $selection)`, async ({ depth, selection, ...expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const input = depth === "8" ? ["xc:#40607060", "xc:#809080b0", "+append"]
        : ["-size", "3x1", "-depth", "16", "-endian", "MSB", "rgba:/input"];
    if (depth === "16") {
        const pixels = Buffer.from("123423453456456756786789789a89ab9abcabcdbcdecdef", "hex");
        files.set("/input", pixels);
        await fs.writeFile("/input", pixels);
    }
    const args = [...input, "-colorspace", "sRGB", ...selection,
        `-adaptive-${operation}`, "1x1", "+channel", "-colorspace", "sRGB", "-depth", depth, "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected[operation]);
});
