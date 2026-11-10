import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { expression: "r,g=>b", expected: "204040c0" },
        { expression: "r", expected: "202020c0" },
        { expression: "r=>g", expected: "202080c0" },
        { expression: "b,g=>b", expected: "804040c0" },
        { expression: "g=>b,r", expected: "204020c0" },
        { expression: "r=>g,b,a", expected: "2080c0c0" },
        { expression: "r<=>b,g", expected: "804040c0" },
        { expression: "r=100,b", expected: "804080c0" },
        { expression: "a,g=>b", expected: "c04040c0" },
    ])(`matches native mixed channel expressions in ${mode}: $expression`, async ({ expression, expected }) => {
        // Native ImageMagick: magick 'xc:#204080c0' -channel-fx EXPR -depth 8 rgba:-
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#204080c0", "-channel-fx", expression, "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out.rgba"];
        const args = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout.push(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await filesystem.readFile("/out.rgba") : files.get("/out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
