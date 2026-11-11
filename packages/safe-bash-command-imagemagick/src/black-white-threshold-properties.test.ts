import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operator of ["-black-threshold", "-white-threshold"]) {
        it.each(["%w0000", "50000", "%[fx:w*10000]", "%50"])(`${mode} ${operator} expands %s`, async cutoff => {
            const input = Buffer.concat([Buffer.from("P5\n5 1\n255\n"), Buffer.from([0, 64, 127, 192, 255])]);
            const files = new Map<string, Uint8Array>([["/in.pgm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.pgm", input);
            const argv = ["/in.pgm", "-channel", "RGB", operator, cutoff, "-depth", "8", "rgb:/out.rgb"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
            const expected = cutoff === "%50"
                ? operator === "-black-threshold" ? [0, 64, 127, 192, 255] : [0, 255, 255, 255, 255]
                : operator === "-black-threshold" ? [0, 0, 0, 0, 255] : [0, 64, 127, 192, 255];
            expect([...output]).toEqual(expected.flatMap(value => [value, value, value]));
            if (cutoff === "%50") expect("stderr" in result ? result.stderr : stderr).toContain("unknown image property");
        });
    }
}
