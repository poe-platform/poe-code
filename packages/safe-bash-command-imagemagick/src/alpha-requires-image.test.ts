import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 rejects alpha operations on an empty image stack.
for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    for (const alpha of ["off", "remove", "set", "deactivate", "extract", "opaque", "offifopaque"]) {
        it.each([
            { name: "before a file", argv: ["-alpha", alpha, "/in.ff", "/out.ff"], exitCode: 1, stdout: "" },
            { name: "before a canvas", argv: ["-alpha", alpha, "xc:red", "-format", "%wx%h", "info:"], exitCode: 1, stdout: "" },
            { name: "after a canvas", argv: ["xc:red", "-alpha", alpha, "-format", "%wx%h", "info:"], exitCode: 0, stdout: "1x1" },
            { name: "after deleting all images", argv: ["/in.ff", "+delete", "-alpha", alpha, "/out.ff"], exitCode: 1, stdout: "" },
        ])(`${execution}: -alpha ${alpha} $name`, async ({ argv, exitCode, stdout }) => {
            const input = Uint8Array.from(Buffer.from("6661726266656c6400000002000000011234abcd8001000080011235cdef8000", "hex"));
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.ff", input], ["/out.ff", keep]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = createCommandArguments(argv);
            let commandStdout = "", commandStderr = "";
            const result = execution === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { commandStdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { commandStderr += new TextDecoder().decode(bytes); } },
            }) : execution === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(exitCode);
            expect("stdout" in result ? result.stdout : commandStdout).toBe(stdout);
            const stderr = "stderr" in result ? result.stderr : commandStderr;
            if (exitCode === 1) expect(stderr).toContain("no images found for operation '-alpha'");
            else expect(stderr).toBe("");
            const destination = execution === "command" || execution === "retained" ? await fs.readFile("/out.ff") : files.get("/out.ff");
            expect(destination).toEqual(keep);
        });
    }
}
