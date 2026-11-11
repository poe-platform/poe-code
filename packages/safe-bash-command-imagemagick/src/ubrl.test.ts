import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const bitmap = new TextEncoder().encode("P1\n3 5\n1 0 0\n0 1 0\n0 0 1\n1 0 0\n0 1 1\n");
const header = "57696474683a20340a4865696768743a20350a0a";
const metadata = "5469746c653a2053616d706c650a583a20310a593a20320a";
const cases = [
    ...["UBRL", "UBRL6"].flatMap(coder => {
        const hex = header + (coder === "UBRL" ? "e2a0a1e2a0840ae2a088e2a0810a" : "e2a0a1e2a0840ae2a081e2a0800a");
        return [
            { target: `${coder}:-`, options: [], hex },
            { target: `${coder}:/out.bin`, options: ["-set", "label", "Sample", "-repage", "9x8+1+2"], hex: metadata + hex },
            { target: `/out.${coder.toLowerCase()}`, options: [], hex }
        ];
    }),
    { target: "pbm:-", options: [], hex: "50340a3320350a8040208060" }
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const write of [false, true]) {
        it.each(cases)(`writes native braille bytes and destinations (${mode}, write=${write}): $target`, async ({ target, options, hex }) => {
            const files = new Map([["/in.ppm", bitmap]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", bitmap);
            const args = ["/in.ppm", ...options, ...(write ? ["-write", target, "null:"] : [target])];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout: "", stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const stdout = mode === "command" ? Buffer.concat(chunks) : Buffer.from(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
            const targetPath = target.includes(":") ? target.slice(target.indexOf(":") + 1) : target;
            const stored = mode === "retained" || mode === "command";
            if (targetPath === "-") expect(stdout.toString("hex")).toBe(hex);
            else {
                expect(stdout.length).toBe(0);
                expect(Buffer.from(stored ? await filesystem.readFile(targetPath) : files.get(targetPath)!).toString("hex")).toBe(hex);
            }
            const names = stored ? (await filesystem.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
            expect(names.sort()).toEqual(["/in.ppm", ...(targetPath === "-" ? [] : [targetPath])].sort());
        });
    }
}
