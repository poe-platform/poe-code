import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const key of ["demo", "demo:key"]) {
    it.each([
      { options: ["-define", `${key}=amber`], expected: "amber|amber|amber", missing: [] },
      { options: ["-define", `${key}=Amber=Gold`], expected: "Amber=Gold|Amber=Gold|Amber=Gold", missing: [] },
      { options: ["-define", `${key}=amber`, "-define", `${key}=gold`], expected: "gold|gold|gold", missing: [] },
      { options: ["-set", key, "amber"], expected: "amber||", missing: [`option:${key}`, `artifact:${key}`] },
      { options: ["-define", `${key}=amber`, "-set", key, "gold"], expected: "gold|amber|amber", missing: [] }
    ])(`formats custom defines and image properties (${mode}, ${key}): $options`, async ({ options, expected, missing }) => {
      const args = ["xc:red", ...options, "-format", `%[${key}]|%[option:${key}]|%[artifact:${key}]`, "info:-"];
      const fs = new MemoryFileSystem();
      let result;
      if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
      } else {
        result = mode === "sync" ? runMagickCliSync(args, new Map())
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
      }
      expect(result).toEqual({
        exitCode: 0, stdout: expected,
        stderr: missing.map(property => `magick: unknown image property '%[${property}]'\n`).join("")
      });
    });
  }
}
