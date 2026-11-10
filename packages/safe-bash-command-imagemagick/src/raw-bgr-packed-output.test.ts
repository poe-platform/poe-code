import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: packed BGR/BGRO below 8 bits uses RGB order.
const cases = [
    ...["bgr", "bgro"].flatMap(coder => [
        { coder, depth: 4, interlace: "None", hex: "147ca3" },
        { coder, depth: 2, interlace: "None", hex: "1690" },
        { coder, depth: 8, interlace: "None", hex: "78451232abcd" },
        { coder, depth: 4, interlace: "Plane", hex: "1c4a73" },
    ]),
    { coder: "rgb", depth: 4, interlace: "None", hex: "147ca3" },
];

for (const mode of ["command", "sync"] as const) {
    it.each(cases)(`${mode}: writes $coder depth $depth interlace $interlace`, async ({ coder, depth, interlace, hex }) => {
        const args = ["xc:#1245789a", "xc:#cdab3243", "+append", "-depth", String(depth), "-interlace", interlace, `${coder}:/out`];
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(mode === "sync" ? [...files.keys()] : (await fs.readdir("/")).map(entry => `/${entry.name}`)).toEqual(["/out"]);
        expect(Buffer.from(mode === "sync" ? files.get("/out")! : await fs.readFile("/out")).toString("hex")).toBe(hex);
    });
}
