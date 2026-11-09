import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

import fixtures from "./compare-profile-fixtures.json" with { type: "json" };

const profile = Uint8Array.from(Buffer.from(fixtures["srgb.icc"], "base64"));
const cases = [
  ["plain.png", "edit.png"],
  ["-profile", "srgb.icc", "plain.png", "edit.png"],
  ["(", "plain.png", "-profile", "srgb.icc", ")", "edit.png"],
  ["plain.png", "edit.png", "-profile", "srgb.icc"],
];

for (const mode of ["buffered", "sync", "retained", "compare", "magick"] as const) {
  const run = async (inputs: string[]) => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map(Object.entries(fixtures).map(([name, bytes]) => [name, Uint8Array.from(Buffer.from(bytes, "base64"))]));
    files.set("diff.png", original);
    files.set("invalid.icc", Uint8Array.of(1, 2, 3));
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    const args = ["-metric", "RMSE", ...inputs, "diff.png"];
    let stdout = "", stderr = "";
    const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
    const result = mode === "compare" || mode === "magick" ? await command.execute({
      command: command.name, args: createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]).args,
      cwd: "/", env: {}, fs: filesystem, stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runCompareCliSync(args, files)
      : await runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    return { exitCode: result.exitCode, stdout: "stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout,
      stderr: "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr,
      output: mode === "buffered" || mode === "sync" ? files.get("diff.png")! : await filesystem.readFile("/diff.png"), original };
  };
  for (const inputs of cases) {
    it(`${mode} compare attaches a profile: ${inputs.join(" ")}`, async () => {
      const result = await run(inputs);
      expect(result.exitCode, result.stderr).toBe(1);
      expect(result.stderr.trim()).toBe("10564.6 (0.161206)");
      expect(result.stdout).toBe("");
      const image = decodeImage(result.output);
      expect(image.icc).toEqual(inputs.includes("-profile") ? profile : undefined);
      const baseline = decodeImage((await run(cases[0]!)).output);
      expect(image.data).toEqual(baseline.data);
    });
  }
  for (const options of [["-profile"], ["-profile", "missing.icc"], ["-profile", "invalid.icc"]]) {
    it(`${mode} compare preserves output for ${options.join(" ")}`, async () => {
      const result = await run(["plain.png", "edit.png", ...options]);
      expect(result.exitCode).toBe(2);
      expect(result.output).toEqual(result.original);
    });
  }
}
