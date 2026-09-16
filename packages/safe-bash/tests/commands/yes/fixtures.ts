import assert from "node:assert/strict";
import { createMemoryFileSystem, type CommandContext, type CommandDefinition } from "../../../src/index.js";

export const gnuHelp = "Usage: yes [STRING]...\n  or:  yes OPTION\nRepeatedly output a line with all specified STRING(s), or 'y'.\n\n      --help        display this help and exit\n      --version     output version information and exit\n\nGNU coreutils online help: <https://www.gnu.org/software/coreutils/>\nReport any translation bugs to <https://translationproject.org/team/>\nFull documentation <https://www.gnu.org/software/coreutils/yes>\nor available locally via: info '(coreutils) yes invocation'\n";
export const gnuVersion = "yes (GNU coreutils) 9.7\nCopyright (C) 2025 Free Software Foundation, Inc.\nLicense GPLv3+: GNU GPL version 3 or later <https://gnu.org/licenses/gpl.html>.\nThis is free software: you are free to change and redistribute it.\nThere is NO WARRANTY, to the extent permitted by law.\n\nWritten by David MacKenzie.\n";
export const virtualVersion = "yes (virtual-bash GNU-compatible profile)\n";

export function capture(args: readonly string[] = [], additions: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "yes", args, cwd: "/", env: {},
    fs: createMemoryFileSystem(),
    stdin: { [Symbol.asyncIterator]() { throw new Error("yes must not read stdin"); } },
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    signal: new AbortController().signal,
    ...additions,
  };
  return { context, stdout, stderr };
}

export async function prefix(command: CommandDefinition, args: readonly string[], length: number, additions: Partial<CommandContext> = {}) {
  const controller = new AbortController();
  const stopped = new Error("bounded prefix complete");
  const bytes = new Uint8Array(length);
  let used = 0;
  let writes = 0;
  let largest = 0;
  const fixture = capture(args, {
    ...additions,
    signal: controller.signal,
    stdout: { async write(chunk) {
      writes++;
      largest = Math.max(largest, chunk.length);
      const count = Math.min(chunk.length, bytes.length - used);
      bytes.set(chunk.subarray(0, count), used);
      used += count;
      if (used === bytes.length) controller.abort(stopped);
    } },
  });
  await assert.rejects(async () => command.execute(fixture.context), error => error === stopped);
  assert.equal(used, length);
  assert.equal(fixture.stderr.length, 0);
  return { bytes, writes, largest };
}
