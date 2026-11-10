import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAIAAAAG+GGPAAAAJUlEQVR4nGMUtojNxwCMMo5pWERVvTAF8xn1giuwiJrHNGKKAgAm2itiRBt5eAAAAABJRU5ErkJggg==", "base64");

for (const mode of ["sync", "buffered", "retained", "command", "mogrify"] as const)
for (const option of ["-wave", "-swirl", "-implode"]) {
    it.each(["bad", "", "2xbad", "NaN", "+1+2", "-1-2", "x", "++2", "--2", "+-2", "-+2", "+%[fx:1]+2", ...(option === "-wave" ? [] : ["x7"])])(`${mode}: rejects ${option} %j without replacing output`, async (argument) => {
        const destination = mode === "mogrify" ? input : new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/input.png", input], ["/out.png", destination]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = mode === "mogrify" ? ["mogrify", option, argument, "/out.png"] : ["/input.png", option, argument, "/out.png"];
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : mode === "buffered" ? await runConvertCli(argv, files)
            : mode === "retained" ? await runConvertCli(argv, { filesystem, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain(`invalid argument for option '${option}'`);
        const output = mode === "sync" || mode === "buffered" ? files.get("/out.png")! : await filesystem.readFile("/out.png");
        expect([...output]).toEqual([...destination]);
    });
}
