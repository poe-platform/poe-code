import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  async function run(options: string[], output: string[]) {
    const input = new Uint8Array([0x20, 0x20, 0x20, 0x40, 0x40, 0x40, 0x40, 0x80, 0x80, 0x80, 0x80, 0xff]);
    const original = new TextEncoder().encode("preserve this destination");
    const files = new Map([["/in.raw", input], ["/existing.raw", original]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["-size", "3x1", "-depth", "8", "rgba:/in.raw", ...options, "-background", "black", ...output];
    let stdout = "", stderr = "", exitCode: number;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      ({ exitCode } = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }));
    } else {
      const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      ({ exitCode, stdout, stderr } = result);
      if (result.stdoutBytes) stdout += new TextDecoder().decode(result.stdoutBytes);
    }
    return { exitCode, stdout, stderr, files, filesystem, original };
  }

  it.each(["Static", "Typo", "", "Centre", "North-West", "north_west", " Center "])(
    `${mode}: rejects invalid gravity %j before emitting or overwriting output`, async gravity => {
      for (const output of [
        ["-format", "%wx%h", "info:"],
        ["-splice", "1x0+0+0", "-depth", "8", "rgba:-"],
        ["rgba:/new.raw"],
        ["rgba:/existing.raw"],
      ]) {
        const result = await run(["-gravity", gravity], output);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`unrecognized gravity type '-gravity' '${gravity}'`);
        expect(result.stdout).toBe("");
        expect([...result.files.keys()]).toEqual(["/in.raw", "/existing.raw"]);
        expect(result.files.get("/existing.raw")).toEqual(result.original);
        expect(await result.filesystem.readdir("/")).toEqual([
          { name: "existing.raw", type: "file" }, { name: "in.raw", type: "file" },
        ]);
        expect(await result.filesystem.readFile("/existing.raw")).toEqual(result.original);
      }
    },
  );

  it.each([
    "Undefined", "None", "Forget", "NorthWest", "North", "NorthEast", "West",
    "Center", "East", "SouthWest", "South", "SouthEast", "sOuThEaSt", "fOrGeT",
  ])(`${mode}: accepts gravity %s without a placement operator`, async gravity => {
    const result = await run(["-gravity", gravity], ["-format", "%wx%h", "info:"]);
    expect({ exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout })
      .toEqual({ exitCode: 0, stderr: "", stdout: "3x1" });
  });

  it(`${mode}: keeps Forget and +gravity equivalent to undefined gravity`, async () => {
    for (const options of [["-gravity", "Forget"], ["-gravity", "Center", "+gravity"]]) {
      const result = await run(options, ["-crop", "50%", "-format", "%wx%h;", "info:"]);
      expect({ exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout })
        .toEqual({ exitCode: 0, stderr: "", stdout: "2x1;1x1;" });
    }
  });
}
