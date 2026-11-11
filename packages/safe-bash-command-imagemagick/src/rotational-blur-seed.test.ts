import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat())]);
// ImageMagick 7.1.2-35 Q16-HDRI, single thread, seed 42.
const cases = [
    { method: "random", rgb: "3b70b03338b33759b14a76aa6f999a4a77a26a269c774997846c928a92935a97a5a41c84b7397dbb5a7b968c8b" },
    { method: "edge", rgb: "3b70b03338b33759b14a76aa6f999a5c64a26a269c774997846c9292948c7f7094a41c84b7397dbb5a7bb3897e" }
];

for (const mode of ["buffered", "sync", "retained", "command"] as const)
it.each(cases)(`matches native seeded rotational blur with $method pixels (${mode})`, async ({ method, rgb }) => {
    for (let repeat = 0; repeat < 3; repeat++) {
        const files = new Map<string, Uint8Array>([["in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["-limit", "thread", "1", "-seed", "42", "in.ppm", "-virtual-pixel", method, "-rotational-blur", "130", ...(repeat === 2 ? ["-seed", "7"] : []), "-depth", "8", "rgb:out.rgb"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out.rgb")! : await fs.readFile("/out.rgb");
        expect(Buffer.from(output).toString("hex")).toBe(rgb);
    }
});
