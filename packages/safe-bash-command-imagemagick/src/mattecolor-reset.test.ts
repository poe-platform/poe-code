import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colored = "20408077204080772040807720408077204080772040807771869bffd7dde3ff6d8daeff2040807720408077e88b9dffdadde0ff6a87a4ff204080772040807720408077204080772040807720408077";
const defaultMatte = "bdbdbdffbdbdbdffbdbdbdffbdbdbdffbdbdbdffbdbdbdff71869bffd7dde3ff6d8daeffbdbdbdffbdbdbdffe88b9dffdadde0ff6a87a4ffbdbdbdffbdbdbdffbdbdbdffbdbdbdffbdbdbdffbdbdbdff";

for (const mode of ["public", "buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["im.pam", "-mattecolor", "#20408077", "+mattecolor"], expected: colored },
        { args: ["-mattecolor", "#20408077", "+mattecolor", "im.pam"], expected: defaultMatte },
        { args: ["im.pam", "-mattecolor", "#20408077"], expected: colored },
        { args: ["im.pam"], expected: defaultMatte },
        { args: ["-mattecolor", "#20408077", "im.pam", "+mattecolor", "+mattecolor"], expected: colored },
        { args: ["im.pam", "-mattecolor", "red", "+mattecolor", "-mattecolor", "#20408077"], expected: colored },
    ])(`matches native matte color reset and controls, ${mode}: $args`, async ({ args, expected }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), ...Array.from({ length: 24 }, (_, i) => (i * 41 + 7) % 256)]);
        const files = new Map([["im.pam", input], ["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const argv = [...args, "-frame", "1x1", "-depth", "8", "rgba:out"];
        let stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
            registerCleanup() {}, fs: filesystem,
        } as unknown as CommandContext) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
