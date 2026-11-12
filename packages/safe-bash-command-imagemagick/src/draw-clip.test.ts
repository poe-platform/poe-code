import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const definition = `push clip-path "limit"
push graphic-context
rectangle 1,1 3,2
pop graphic-context
pop clip-path`;
const clipped = 'clip-path "url(#limit)"\nrectangle 0,0 5,3';
// Complete 6x4 RGB rasters from ImageMagick 7.1.2-35 Q16-HDRI.
const rectangleHash = "7113fe0c99e1dbe47c560862c93dfa3de45d287b682a93e8a86b9bc2fe5c5589";
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["without defs", `push graphic-context\n${definition}\npush graphic-context\n${clipped}\npop graphic-context\npop graphic-context`, rectangleHash],
        ["inside defs", `push graphic-context\npush defs\n${definition}\npop defs\npush graphic-context\n${clipped}\npop graphic-context\npop graphic-context`, rectangleHash],
        ["restore unclipped context", `push graphic-context\npush defs\n${definition}\npop defs\npush graphic-context\n${clipped}\npop graphic-context\nfill red\npoint 5,3\npop graphic-context`, "b20d4cd805e41651683842b6dc3237118b7c7e674777e08e2a8da7ea5f480ae6"],
        ["unused definition", `push graphic-context\npush defs\n${definition}\npop defs\npush graphic-context\nrectangle 0,0 5,3\npop graphic-context\npop graphic-context`, "834a709ba2534ebe3ee1397fd4f7bd288b2acc1d20a08d6c862dcd99b6f04400"],
        ["rectangle control", "rectangle 1,1 3,2", rectangleHash],
        ["definition does not paint", definition, createHash("sha256").update(Buffer.alloc(72, 255)).digest("hex")],
        ["restore previous named clip", `${definition}\npush clip-path inner\nrectangle 2,1 2,1\npop clip-path\nclip-path "url(#limit)"\npush graphic-context\nclip-path "url(#inner)"\nfill red\nrectangle 0,0 5,3\npop graphic-context\nrectangle 0,0 5,3`, rectangleHash],
        ["flush SVG drawing before restoring clip", `${definition}\npush graphic-context\nclip-path "url(#limit)"\npoint 5,3\npop graphic-context\nrectangle 1,1 3,2`, rectangleHash],
        ["SVG clip geometry", `push clip-path limit\npath 'M 1,1 H 3 V 2 H 1 Z'\npop clip-path\n${clipped}`, rectangleHash],
    ])(`${mode}: %s`, async (_name, drawing, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        const argv = ["-size", "6x4", "xc:white", "-stroke", "none", "-fill", "black", "-draw", drawing,
            "-depth", "8", mode === "command" ? "rgb:-" : "rgb:out.rgb"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out.rgb") : files.get("out.rgb")!;
        expect(output).toHaveLength(72);
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
