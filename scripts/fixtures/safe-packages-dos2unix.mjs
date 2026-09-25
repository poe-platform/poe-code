import { Shell, getCommandArguments, createCommandArguments, CommandArgumentIdentityError, FsError } from "@poe-platform/safe-bash";
import { createDos2unixCommand, createUnix2dosCommand } from "@poe-platform/safe-bash/commands/line-endings";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";

function assert(condition, message) { if (!condition) throw new Error(message); }

export async function verifyDos2unix() {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/\ufeffinput", Uint8Array.of(239, 187, 191, 65, 13, 10, 66, 10), { mode: 0o640 });
  await fs.writeFile("/script.sh", new TextEncoder().encode('dos2unix -q -b -k "$1"; unix2dos -q -b -n "$1" /output; dos2unix -q -b -O /output | unix2dos -b\n'));
  const before = await fs.stat("/\ufeffinput");
  const shell = new Shell({ fs });
  shell.commands.register(createDos2unixCommand());
  shell.commands.register(createUnix2dosCommand());
  let inspected = 0;
  shell.use(async (context, next) => {
    if (context.command === "dos2unix" || context.command === "unix2dos") {
      getCommandArguments(context);
      inspected++;
    }
    return next();
  });
  try {
    const result = await shell.exec("sh /script.sh $'\\ufeffinput'");
    assert(result.exitCode === 0 && result.stderr === "" && JSON.stringify([...result.stdoutBytes]) === "[239,187,191,65,13,10,66,13,10]", "packed line-ending script or pipe differs: " + JSON.stringify(result));
    assert(inspected === 4, "line-ending command bypassed middleware");
    const after = await fs.stat("/\ufeffinput");
    assert(after.mode === before.mode && after.mtimeMs === Math.floor(before.mtimeMs / 1000) * 1000, "line-ending file metadata changed");
    for (const byte of ["ff", "fe"]) {
      const invalid = await shell.exec(`dos2unix $'\\x${byte}'`);
      assert(invalid.exitCode === 1 && invalid.stderr === "dos2unix: arguments must be valid UTF-8 paths\n", "line-ending command lost raw byte identity");
    }
    let duplicate;
    try { shell.commands.register(createDos2unixCommand()); } catch (reason) { duplicate = reason; }
    assert(duplicate, "line-ending command ignored registration collision");
    const caller = new AbortController();
    caller.abort(false);
    const cancelled = await shell.exec("dos2unix", { signal: caller.signal }).then(() => ({ ok: true }), reason => ({ reason }));
    assert(Object.hasOwn(cancelled, "reason") && cancelled.reason === false, "line-ending cancellation identity changed");
    const activeCaller = new AbortController();
    const active = shell.exec("dos2unix", { stdin: "A".repeat(32768), signal: activeCaller.signal })
      .then(() => ({ ok: true }), reason => ({ reason }));
    const timer = setTimeout(() => activeCaller.abort(false), 0);
    try {
      const cancelled = await active;
      assert(Object.hasOwn(cancelled, "reason") && cancelled.reason === false, "active line-ending conversion lost cancellation identity");
    } finally { clearTimeout(timer); }
    shell.commands.register(createDos2unixCommand({ limits: { maxInputBytes: 1 } }), { replace: true });
    const limited = await shell.exec("dos2unix", { stdin: "AB" });
    assert(limited.exitCode === 1 && limited.stderr === "dos2unix: input bytes limit exceeded\n", "line-ending command ignored explicit limits");
  } finally { await shell.dispose(); }

  const carrier = createCommandArguments([]);
  const context = { command: "dos2unix", args: carrier.args, argumentValues: carrier, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  const mismatch = await createDos2unixCommand().execute({ ...context, args: [] }).then(() => undefined, reason => reason);
  assert(mismatch instanceof CommandArgumentIdentityError, "private command duplicated argument error constructor");
  const failure = new FsError("EIO", { path: "/input" });
  const failed = await createDos2unixCommand().execute({ ...context, stdin: { [Symbol.asyncIterator]() { throw failure; } } }).then(() => undefined, reason => reason);
  assert(failed === failure, "private command changed filesystem error identity");

  const boundedFs = new MemoryFileSystem();
  const bounded = new Shell({ fs: boundedFs });
  bounded.commands.register(createDos2unixCommand());
  await boundedFs.writeFile("/input", Uint8Array.of(65, 13, 10));
  try {
    const failure = await bounded.exec("dos2unix -q /input", { limits: { maxOutputBytes: 1 } }).then(() => undefined, reason => reason);
    assert(failure?.name === "ShellLimitError", "private file writes bypassed the Shell output budget");
    assert(JSON.stringify([...await boundedFs.readFile("/input")]) === "[65,13,10]", "failed conversion published partial file");
    assert((await boundedFs.readdir("/")).length === 1, "failed conversion leaked staged file");
  } finally { await bounded.dispose(); }
}
