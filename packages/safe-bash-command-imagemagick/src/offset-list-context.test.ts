import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGB rasters from ImageMagick 7.1.2-35 Q16-HDRI.
const roll0 = "6683a0bddaf714314e6b88a5c2dffc193653708daac7e4010a2744617e9bb8d5f20f2c49";
const roll1 = "6b88a56683a0bddaf714314ec7e401c2dffc193653708daa0f2c490a2744617e9bb8d5f2";
const roll2 = "14314e6b88a56683a0bddaf7708daac7e401c2dffc193653b8d5f20f2c490a2744617e9b";
const chop0 = "bddaf714314e6b88a5193653708daac7e401";
const chop1 = "6683a014314e6b88a5c2dffc708daac7e401";
const splice1 = "ffffffffffffffffffffffffffffff0a2744ffffff617e9bb8d5f20f2c496683a0ffffffbddaf714314e6b88a5c2dffcffffff193653708daac7e401";
const splice2 = "ffffffffffffffffffffffffffffff0a2744617e9bffffffb8d5f20f2c496683a0bddaf7ffffff14314e6b88a5c2dffc193653ffffff708daac7e401";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { count: 2, operation: "-roll", geometry: "+%p-1", expected: roll0 + roll1 },
        { count: 2, operation: "-roll", geometry: "+%[fx:t]-1", expected: roll0 + roll1 },
        { count: 2, operation: "-roll", geometry: "+%n-1", expected: roll2 + roll2 },
        { count: 2, operation: "-roll", geometry: "+%[fx:n]-1", expected: roll2 + roll2 },
        { count: 2, operation: "-chop", geometry: "1x1+%p+0", expected: chop0 + chop1 },
        { count: 2, operation: "-chop", geometry: "1x1+%[fx:t]+0", expected: chop0 + chop1 },
        { count: 2, operation: "-splice", geometry: "1x1+%n+0", expected: splice2 + splice2 },
        { count: 2, operation: "-splice", geometry: "1x1+%[fx:n]+0", expected: splice2 + splice2 },
        { count: 2, operation: "-roll", geometry: "+1-1", expected: roll1 + roll1 },
        { count: 2, operation: "-roll", geometry: "+2-1", expected: roll2 + roll2 },
        { count: 1, operation: "-chop", geometry: "1x1+%[fx:t]+0", expected: chop0 },
        { count: 1, operation: "-splice", geometry: "1x1+%[fx:n]+0", expected: splice1 },
    ])(`expands $operation $geometry for $count images (${mode})`, async ({ count, operation, geometry, expected }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => (29 * i + 10) % 256)]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = [...Array<string>(count).fill("/in.ppm"), operation, geometry, "-depth", "8", "rgb:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
