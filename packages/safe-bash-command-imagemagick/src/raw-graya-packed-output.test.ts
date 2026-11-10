import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI packed GRAYA output and separate-plane controls.
const cases = [
    { input: ["xc:#3e3e3e"], depth: 4, interlace: "None", hex: "40" },
    { input: ["xc:#3e3e3e"], depth: 4, interlace: "Plane", hex: "40f0" },
    { input: ["-size", "4x2", "xc:#3e3e3e9a"], depth: 1, interlace: "None", hex: "ffff" },
    { input: ["xc:#ffffff00", "xc:#000000ff", "+append"], depth: 4, interlace: "None", hex: "f000" },
    ...[
        { depth: 1, interlace: "None", hex: "e0" },
        { depth: 2, interlace: "None", hex: "65" },
        { depth: 4, interlace: "None", hex: "4a64" },
        { depth: 8, interlace: "None", hex: "3e9a6943" },
        { depth: 4, interlace: "Plane", hex: "4694" },
        { depth: 4, interlace: "Line", hex: "4694" },
    ].map(test => ({ ...test, input: ["xc:#3e3e3e9a", "xc:#69696943", "+append"] })),
];

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: writes GRAYA $input depth $depth interlace $interlace`, async ({ input, depth, interlace, hex }) => {
        const args = [...input, "-depth", String(depth), "-interlace", interlace, "graya:/out"];
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runMagickCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(mode !== "command" ? [...files.keys()] : (await fs.readdir("/")).map(entry => `/${entry.name}`)).toEqual(["/out"]);
        expect(Buffer.from(mode !== "command" ? files.get("/out")! : await fs.readFile("/out")).toString("hex")).toBe(hex);
    });
}
