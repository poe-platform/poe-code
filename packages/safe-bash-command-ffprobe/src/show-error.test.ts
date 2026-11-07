import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";

it.each([
  ["json", '{"error":{"code":-2,"string":"No such file or directory"}}'],
  ["compact", "error|code=-2|string=No such file or directory\n"],
  ["xml", '<?xml version="1.0" encoding="UTF-8"?>\n<ffprobe>\n    <error code="-2" string="No such file or directory"/>\n</ffprobe>\n'],
  ["default", "[ERROR]\ncode=-2\nstring=No such file or directory\n[/ERROR]\n"],
  ["csv", "error,-2,No such file or directory\n"],
  ["flat", 'error.code=-2\nerror.string="No such file or directory"\n'],
  ["ini", "# ffprobe output\n\n[error]\ncode=-2\nstring=No such file or directory\n"],
])("reports missing input with the %s writer", async (writer, expected) => {
  let stdout = "", stderr = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-of", writer, "-show_error", "absent.wav"]),
    cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  expect(result.exitCode).toBe(1);
  expect(stderr).toContain("absent.wav");
  if (writer === "json") expect(JSON.parse(stdout)).toEqual(JSON.parse(expected));
  else expect(stdout).toBe(expected);
});

 it.each([
   { args: [], limit: undefined, quiet: false },
   { args: ["-show_error"], limit: 1, quiet: false },
   { args: ["-show_error"], limit: undefined, quiet: true },
 ])("preserves error output controls: %j", async ({ args, limit, quiet }) => {
   let stdout = "", stderr = "";
   const result = await createFfprobeCommand({ limits: { maxOutputBytes: limit } }).execute({
     command: "ffprobe", ...createCommandArguments(["-v", quiet ? "quiet" : "error", "-of", "json", ...args, "absent.wav"]),
     cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
     stdin: { async *[Symbol.asyncIterator]() {} },
     stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
     stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
   });
   expect(result.exitCode).toBe(1);
   if (quiet) {
     expect(stderr).toBe("");
     expect(JSON.parse(stdout)).toEqual({ error: { code: -2, string: "No such file or directory" } });
   } else {
     expect(stdout).toBe("");
     expect(stderr).not.toBe("");
   }
 });
