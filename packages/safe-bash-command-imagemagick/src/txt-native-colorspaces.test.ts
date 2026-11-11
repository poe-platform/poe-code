import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./txt-native-colorspaces-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#3685c3 -colorspace SPACE -depth DEPTH txt:-.
// The 16-bit fixtures set 37% alpha before conversion. Expected output comes from
// reading the same native bytes with -format '%[colorspace]/%[pixel:p{0,0}]' info:.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const prefix of ["", "txt:"]) {
    it.each(fixtures)(`reads native $space TXT at $depth bits (${mode}, ${prefix || "signature"})`, async fixture => {
      const bytes = new TextEncoder().encode(fixture.text);
      const files = new Map([["/native.dat", bytes]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/native.dat", bytes);
      const args = [prefix + "/native.dat", "-format", "%[colorspace]/%[pixel:p{0,0}]", "info:"];
      let result;
      if (mode === "command") {
        let stdout = "", stderr = "";
        const command = createMagickCommand(), argumentValues = createCommandArguments(args);
        const execution = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues,
          cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { exitCode: execution.exitCode, stdout, stderr };
      } else {
        result = mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      }
      expect(result).toMatchObject({ exitCode: fixture.exitCode, stdout: fixture.stdout });
      if (fixture.exitCode === 0) expect(result.stderr).toBe("");
      else expect(result.stderr).toContain("Unsupported TXT colorspace: ohta");
    });
  }
}
