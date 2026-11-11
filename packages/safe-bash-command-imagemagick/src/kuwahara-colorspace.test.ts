import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, depth 8 raw output.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const fixture of [
    { space: "HSL", filter: true, format: "rgb", expected: "2c789c3164cb8b2fd93bb0b53175bb3175bb" },
    { space: "CMYK", filter: true, format: "rgb", expected: "3a6584757889ac5d7260888d7c947d797a7b" },
    { space: "CMYK", filter: true, format: "cmyk", expected: "964912715e5b43453190762a71352e535a39584057565547" },
    { space: "HSL", filter: true, options: ["-channel", "R"], format: "rgb", expected: "13455d829acc8d17f160a7aa1af4e73e6388" },
    { space: "CMYK", filter: true, options: ["-channel", "K"], format: "cmyk", expected: "cb6500715d2e004500e8c12a6f3800532700e5408b450047" },
    { space: "CMYK", filter: true, options: ["-region", "2x1+1+0"], format: "cmyk", expected: "cb6500a251526637399564336f3800552700e50b8b450077" },
    { space: "CMYK", filter: true, options: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel"], format: "cmyka", expected: "96491271805e5b4345803190762a8071352e53805a395840805756554780" },
    { space: "HSL", filter: true, options: ["-kuwahara", "1x1"], format: "rgb", expected: "3183ad305cc0382dd13597b32f59c32f59c3" },
    { space: "CMYK", filter: true, options: ["-kuwahara", "1x1"], format: "cmyk", expected: "7f48275e615b464945736337723d3254604a4948515c5b40" },
    { space: "sRGB", filter: true, format: "rgb", expected: "476c7eb45465b45465698e8086976a847667" },
    { space: "CMYK", filter: false, format: "cmyk", expected: "cb6500a25d2e003300e8c10e6f3800552700e50b8b450077" },
]) it(`Kuwahara ${fixture.space} to ${fixture.format}, ${fixture.options?.join(" ") ?? "all channels"}, filter=${fixture.filter} (${mode})`, async () => {
    const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => (i * 37 + 19) % 256))]);
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-colorspace", fixture.space, ...(fixture.options ?? []), ...(fixture.filter ? ["-kuwahara", "1x1"] : []), "+channel", "+region", "-depth", "8", `${fixture.format}:${mode === "command" ? "-" : "/out.raw"}`];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async chunk => { stdout += Buffer.from(chunk).toString("hex"); } }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!).toString("hex");
    expect(output).toBe(fixture.expected);
});
