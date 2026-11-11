import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const operator of ["-write", "+write"]) {
    it.each(["info:report", "info:report.txt", "info:", "info:-"])(`${mode} ${operator} routes %s without changing pixels`, async destination => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      const args = ["-size", "3x2", "xc:red", "-format", "%wx%h", "-depth", "8", operator, destination, "-negate", "rgb:end.raw"];
      const retained = mode === "retained" || mode === "command";
      let result;
      if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        result = { ...status, stdout, stderr };
      } else result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, retained ? { filesystem: fs, cwd: "/" } : files);
      const target = destination.slice(5);
      const named = target !== "" && target !== "-";
      expect(result).toEqual({ exitCode: 0, stdout: named ? "" : "3x2", stderr: "" });
      if (named) expect(retained ? await fs.readFile(`/${target}`) : files.get(target)).toEqual(new TextEncoder().encode("3x2"));
      expect(retained ? await fs.readFile("/end.raw") : files.get("end.raw")).toEqual(Uint8Array.from({ length: 18 }, (_, i) => i % 3 ? 255 : 0));
      if (retained) expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual((named ? [target, "end.raw"] : ["end.raw"]).sort());
      else expect([...files.keys()].sort()).toEqual((named ? [target, "end.raw"] : ["end.raw"]).sort());
    });
  }
}
