import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, patterned 12x8 PPM input.
for (const mode of ["command", "buffered", "sync"] as const) it.each([
    { options: [], hash: "528bf55864c1e4ae2f9b9c95256fde30722ebc3d350e1ca895e67f7433129749" },
    { options: ["-bordercolor", "orange"], hash: "f34353c6025236b2e97be509986b00c800e7547453e3738f5bf2347faba3f235" },
    { options: ["-set", "option:bordercolor", "orange"], hash: "f34353c6025236b2e97be509986b00c800e7547453e3738f5bf2347faba3f235" },
    { options: ["-set", "bordercolor", "orange"], hash: "528bf55864c1e4ae2f9b9c95256fde30722ebc3d350e1ca895e67f7433129749" },
    { options: ["-set", "option:bordercolor", "orange", "+set", "option:bordercolor"], hash: "f34353c6025236b2e97be509986b00c800e7547453e3738f5bf2347faba3f235" },
    { options: ["-set", "option:bordercolor", "orange", "-bordercolor", "blue"], hash: "ce786d886092845ee8fb1ecdebebba9f38cd20cb7c004778da712f068aa04a7c" },
    { options: ["-bordercolor", "blue", "-set", "option:bordercolor", "orange"], hash: "f34353c6025236b2e97be509986b00c800e7547453e3738f5bf2347faba3f235" },
    { options: ["-bordercolor", "blue", "-set", "option:bordercolor", "orange", "+set", "option:bordercolor"], hash: "f34353c6025236b2e97be509986b00c800e7547453e3738f5bf2347faba3f235" },
])(`${mode}: matches native polaroid border settings $options`, async ({ options, hash }) => {
    const input = Buffer.concat([Buffer.from("P6\n12 8\n255\n"), Buffer.from(Array.from({ length: 288 }, (_, i) => (i * 13 + 7) % 256))]);
    const files = new Map([["in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = ["in.ppm", ...options, "-polaroid", "0", "-depth", "8", "rgba:out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files) : mode === "buffered" ? await runMagickCli(argv, files) : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
    });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
    expect(output.byteLength).toBe(5760);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
