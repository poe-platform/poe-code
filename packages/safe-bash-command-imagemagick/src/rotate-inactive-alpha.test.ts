import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete row-major RGBA from ImageMagick 7.1.2-35 Q16-HDRI:
// magick -size 5x3 'xc:#2878a080' -alpha MODE -background COLOR -rotate 30 -depth 8 rgba:-
const opaqueSource = "00000000000000000000000000000000000000000000000000000000000000002878a0412878a0d32878a03b000000000000000000000000000000002878a0cf2878a0ff2878a0ff2878a0ab2878a019000000002878a02f2878a0ff2878a0ff2878a0ff2878a0ff2878a0ff2878a02f000000002878a0192878a0ab2878a0ff2878a0ff2878a0cf000000000000000000000000000000002878a03b2878a0d32878a0410000000000000000000000000000000000000000000000000000000000000000";
const translucentBackground = "9030a080962ca07c922fa07f992aa07b9030a0809030a0809030a080982ba07b664da0a03271a0e9694ba09d9e26a078942ea07e9030a080932ea07e3371a0e7257aa0ff2679a0ff3c6aa0d57e3da08c992aa07b6f47a0982679a0ff267aa0ff2878a0ff267aa0ff2679a0ff6f47a098992aa07b7e3da08c3c6aa0d52679a0ff257aa0ff3371a0e7932ea07e9030a080942ea07e9e26a078694ba09d3271a0e9664da0a0982ba07b9030a0809030a0809030a080992aa07b922fa07f962ca07c9030a080";
const activeSource = "00000000000000000000000000000000000000000000000000000000000000002878a0202878a06a2878a01d000000000000000000000000000000002878a0682878a0892878a0852878a0562878a00c000000002878a0182878a0852878a0862878a0802878a0862878a0852878a018000000002878a00c2878a0562878a0852878a0892878a068000000000000000000000000000000002878a01d2878a06a2878a0200000000000000000000000000000000000000000000000000000000000000000";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "discrete", background: "none", expected: opaqueSource },
        { alpha: "deactivate", background: "none", expected: opaqueSource },
        { alpha: "discrete", background: "#9030a080", expected: translucentBackground },
        { alpha: "", background: "none", expected: activeSource },
    ])(`${mode}: rotates $alpha alpha onto $background`, async ({ alpha, background, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "5x3", "xc:#2878a080", ...(alpha ? ["-alpha", alpha] : []),
            "-background", background, "-rotate", "30", "-depth", "8", "rgba:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

for (const angle of ["0", "90"]) {
    it.each(["discrete", "deactivate"])(`retains stored %s alpha through a ${angle}-degree rotation`, alpha => {
        const files = new Map<string, Uint8Array>();
        const result = runMagickCliSync(["-size", "5x3", "xc:#2878a080", "-alpha", alpha,
            "-background", "none", "-rotate", angle, "-alpha", "activate", "-depth", "8", "rgba:out"], files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(Buffer.from(files.get("out")!).toString("hex")).toBe("2878a080".repeat(15));
    });
}
