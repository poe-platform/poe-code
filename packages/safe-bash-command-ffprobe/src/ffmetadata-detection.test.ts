import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

it.each([
  { filename: "plain.ffmetadata", header: "", forced: false, exitCode: 1 },
  { filename: "plain.ffmeta", header: "", forced: false, exitCode: 1 },
  { filename: "plain.bin", header: "", forced: false, exitCode: 1 },
  { filename: "valid.bin", header: ";FFMETADATA1\n", forced: false, exitCode: 0 },
  { filename: "valid.bin", header: ";FFMETADATA2\n", forced: false, exitCode: 0 },
  { filename: "valid.ffmetadata", header: ";FFMETADATA1\n", forced: false, exitCode: 0 },
  { filename: "plain.ffmetadata", header: "", forced: true, exitCode: 0 }
])("probes $filename with header '$header' and forced=$forced", async ({ filename, header, forced, exitCode }) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile(`/${filename}`, new TextEncoder().encode(`${header}title=sample\n`));
  const args = ["-v", "error", "-show_entries", "format=format_name", "-of", "json",
    ...(forced ? ["-f", "ffmetadata"] : []), `/${filename}`];
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(exitCode);
  if (exitCode === 0) {
    expect(JSON.parse(output)).toEqual({ format: { format_name: "ffmetadata" } });
    expect(diagnostic).toBe("");
  } else {
    expect(diagnostic).toContain("Invalid data found when processing input");
    expect(output).not.toContain('"ffmetadata"');
  }
});
