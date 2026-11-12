import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const cases = [
    {
        name: "Bumpmap with alpha off",
        args: ["composite", "-alpha", "off", "-compose", "Bumpmap", "/in.ppm", "/base.ppm"],
        hex: "0c0804ff432e19ffa06e3cffa06e3cffa06e3cff",
    },
    {
        name: "Bumpmap with alpha set",
        args: ["composite", "-alpha", "set", "-compose", "Bumpmap", "/in.ppm", "/base.ppm"],
        hex: "0c080413432e196ba06e3cffa06e3cffa06e3cff",
    },
    {
        name: "Over with alpha set",
        args: ["composite", "-alpha", "set", "/in.ppm", "/base.ppm"],
        hex: "0a141eff5a6e82ffa06e3cffa06e3cffa06e3cff",
    },
    {
        name: "Over without alpha option",
        args: ["composite", "/in.ppm", "/base.ppm"],
        hex: "0a141eff5a6e82ffa06e3cffa06e3cffa06e3cff",
    },
    {
        name: "conversion Bumpmap with alpha set",
        args: ["/base.ppm", "/in.ppm", "-alpha", "set", "-compose", "Bumpmap", "-composite"],
        hex: "0c080413432e196ba06e3cffa06e3cffa06e3cff",
    },
];

for (const route of ["command", "standalone", "buffered", "sync"])
for (const { name, args, hex } of cases) {
    if (route === "standalone" && args[0] !== "composite") continue;
    it(`${route}: ${name} matches native ImageMagick RGBA8`, async () => {
        const files = new Map([
            ["/in.ppm", Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])])],
            ["/base.ppm", Buffer.concat([Buffer.from("P6\n5 1\n255\n"), Buffer.from(Array(5).fill([160, 110, 60]).flat())])],
        ]);
        const argv = [...args, "-depth", "8", "rgba:-"];
        let output: Uint8Array;
        if (route === "command" || route === "standalone") {
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const command = route === "standalone" ? createCompositeCommand() : createMagickCommand();
            const result = await command.execute({
                command: command.name, args: createCommandArguments(route === "standalone" ? argv.slice(1) : argv).args,
                cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
            output = Buffer.concat(chunks);
        } else {
            const result = route === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
            expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
            output = result.stdoutBytes ?? new Uint8Array();
        }
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
