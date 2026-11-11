import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("50360a3420320a3235350aff000000ff000000ffffffff000000ff8000fe0180804080", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI references for the same PPM and arguments.
const cases = [
    { coder: "ycbcr", options: [], hex: "4c54ff962b151dff6bff7f80008080972ac95b94f45a959a" },
    { coder: "ycbcra", options: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel"], hex: "4c54ff80962b15801dff6b80ff7f808000808080972ac9805b94f4805a959a80" },
    { coder: "ycbcra", options: [], hex: "4c54ffff962b15ff1dff6bffff7f80ff008080ff972ac9ff5b94f4ff5a959aff" },
    { coder: "rgb", options: [], hex: "ff000000ff000000ffffffff000000ff8000fe0180804080" },
];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode} writes raw $coder bytes to stdout without creating a file`, async ({ coder, options, hex }) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "-depth", "8", `${coder}:-`];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "retained" ? await runMagickCli(args, { filesystem: fs, cwd: "/" })
            : mode === "buffered" ? await runMagickCli(args, files) : runMagickCliSync(args, files);
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) chunks.push(result.stdoutBytes);
        if ("stderr" in result) stderr = result.stderr as string;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.concat(chunks).toString("hex")).toBe(hex);
        expect([...files.keys()]).toEqual(["/in.ppm"]);
        expect(await fs.readdir("/")).toEqual([{ name: "in.ppm", type: "file" }]);
    });
}

for (const retained of [false, true]) {
    it.each(cases.slice(0, 2))(`recognizes $coder extensions and explicit coder prefixes in intermediate writes, retained=${retained}`, async ({ coder, options, hex }) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const result = await runMagickCli(["/in.ppm", ...options, "-depth", "8", "-write", `${coder.toUpperCase()}:/out.png`, "+write", `/out.${coder}`, "rgb:-"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(cases[3]!.hex);
        for (const path of ["/out.png", `/out.${coder}`]) {
            expect(Buffer.from(retained ? await filesystem.readFile(path) : files.get(path)!).toString("hex")).toBe(hex);
        }
    });
}
