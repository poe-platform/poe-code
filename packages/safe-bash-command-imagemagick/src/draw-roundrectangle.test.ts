import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete 12x10 8-bit gray rasters.
const fixtures = [
    { draw: "roundrectangle 1,1 9,7 3,3", fill: "none", stroke: "black", hash: "a6a5ae30582629c5fc450d54a010988fea4dae00926746caba73ec98f658d0d7" },
    { draw: "roundrectangle 1,1 9,7 1,1", fill: "none", stroke: "black", hash: "03bc2d74c2df3e865f7b6bfd0b3b19bdb77d6899fa8fc87610fa14a06f188a50" },
    { draw: "rectangle 1,1 9,7", fill: "none", stroke: "black", hash: "9a012196d3c01c174d8d0519a3c81423866f7a05f8f6c2a94717afa650ee11d4" },
    { draw: "roundrectangle 1,1 9,7 3,3", fill: "black", stroke: "none", hash: "daf9735d49938c87d316916f34b1127e8a30c95016025dac160a6758da6e9e0a" },
    { draw: "rectangle 1,1 9,7", fill: "black", stroke: "none", hash: "c4f84833663596b1040b074dcd9d51b917dc03485d2b33a341b56c9c2d436dd9" },
];

for (const mode of ["map", "filesystem", "command"] as const) {
    it.each(fixtures)(`${mode}: matches native $draw, fill $fill, stroke $stroke`, async ({ draw, fill, stroke, hash }) => {
        const args = ["-size", "12x10", "xc:white", "-fill", fill, "-stroke", stroke, "-draw", draw, "-depth", "8", "gray:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const filesystem = new MemoryFileSystem();
        const cli = mode === "command" ? undefined : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : new Map());
        const result = cli ?? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async bytes => { chunks.push(bytes.slice()); } },
            stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode, cli?.stderr ?? stderr).toBe(0);
        expect(cli?.stderr ?? stderr).toBe("");
        const output = cli?.stdoutBytes ?? Buffer.concat(chunks);
        expect(output).toHaveLength(120);
        expect(createHash("sha256").update(output).digest("hex"), Buffer.from(output).toString("hex")).toBe(hash);
    });
}
