import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["Discrete", "ffffffffcfb7abffffffffff"],
        ["Deactivate", "ffffffffcfb7abffffffffff"],
        ["Disassociate", "ffffffffffdfbfffffffffff"],
        ["On", "ffffffffcfb7abffffffffff"],
        ["Off", "ffffffff804020ffffffffff"],
    ])(`${mode}: borders alpha %s using its retained opacity`, async (alpha, expected) => {
        // ImageMagick 7.1.2-35 Q16-HDRI raw RGBA output.
        const argv = ["xc:#80402060", "-alpha", alpha, "-background", "white", "-bordercolor", "white", "-border", "1x0", "-depth", "8", "rgba:/out"];
        const filesystem = new MemoryFileSystem();
        const keep = new TextEncoder().encode("KEEP");
        await filesystem.writeFile("/out", keep);
        const files = new Map([["/out", keep]]);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
