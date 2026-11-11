import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const original = "0000c8112fc1225eba338db344bcac55eba5661a9e77499788789099a789aad682bb057bcc3474dd636dee9266";

// Complete RGB reference output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const depth of [8, 16])
for (const [before, after, denoised] of [
    [["-evaluate", "multiply", "3"], ["-evaluate", "divide", "3"], "1212b62341af3458a8457ea156aa9a59d99d61239972499283738b8c958898c494a9178dba4386cb6b7fdc8078"],
    [["-evaluate", "subtract", "50%"], ["-evaluate", "add", "50%"], "3732a54852a259619b6a7594748c926bc09573519479579180718f83828d7a9f98843496954c93a66b8cb77789"]
] as const)
it.each([undefined, "0", "20%"])(`preserves ${depth}-bit working samples after ${before.join(" ")} at threshold %s (${mode})`, async threshold => {
    const pixels = Buffer.from(original, "hex");
    const input = Buffer.concat([
        Buffer.from(`P6\n5 3\n${depth === 16 ? 65535 : 255}\n`),
        depth === 16 ? Buffer.from(Array.from(pixels).flatMap(value => [value, value])) : pixels
    ]);
    const files = new Map([["/input.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.ppm", input);
    const args = ["/input.ppm", ...before,
        ...(threshold === undefined ? [] : ["-wavelet-denoise", threshold]),
        ...after, "-depth", "8", "rgb:/output.rgb"];
    let stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stderr } : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/output.rgb") : files.get("/output.rgb")!;
    expect(Buffer.from(output).toString("hex")).toBe(threshold === "20%" ? denoised : original);
});
