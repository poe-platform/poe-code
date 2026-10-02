import { Shell, createCsplitCommand as rootCommand, createCsplitCommands as rootCommands, csplitCommands as rootPlugin } from "@poe-platform/safe-bash";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createCsplitCommand, createCsplitCommands, csplitCommands } from "@poe-platform/safe-bash/commands/csplit";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createCsplitCommand && rootCommands === createCsplitCommands && rootPlugin === csplitCommands, "csplit public factory identity");
  check(JSON.stringify(createCsplitCommands().map(command => command.name)) === '["csplit"]', "csplit inventory");
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(csplitCommands());
  try {
    check((await shell.exec("csplit --help")).exitCode === 0, "csplit registration");
    const host = { commands: shell.commands, use() {}, registerFileSystem() {} };
    const original = shell.commands.get("csplit");
    let collision;
    const duplicate = csplitCommands();
    try { await duplicate.setup(host); } catch (error) { collision = error; }
    finally { await duplicate.dispose(); }
    check(collision && shell.commands.get("csplit") === original, "csplit collision preserves registration");
    shell.use(csplitCommands({ replace: true }));
    check((await shell.exec("csplit --help")).exitCode === 0, "csplit replacement registration");
    check(shell.commands.get("csplit") !== original, "csplit explicit replacement");
    shell.commands.register({ name: "relay", async execute(context) {
      for await (const chunk of context.stdin) await context.stdout.write(chunk);
      return { exitCode: 0 };
    } });
    await fs.writeFile("/split.sh", new TextEncoder().encode('csplit -f piece "$1" 2 | relay'));
    await fs.writeFile("/input", Uint8Array.of(255, 10, 254, 10, 65, 10));
    const result = await shell.exec("sh /split.sh /input");
    check(result.exitCode === 0 && result.stderr === "" && result.stdout === "2\n4\n", "csplit VFS script and pipeline");
    check(JSON.stringify([...await fs.readFile("/piece00")]) === '[255,10]' && JSON.stringify([...await fs.readFile("/piece01")]) === '[254,10,65,10]', "csplit raw file bytes");
    const regex = await shell.exec("csplit -s --suppress-matched -f match - '/two/' '{*}'", { stdin: "one\ntwo\nthree\ntwo\nfour\n" });
    check(regex.exitCode === 0 && regex.stdout === "" && regex.stderr === "", "csplit repeated regex suppression");
    for (const [name, expected] of [["match00", "one\n"], ["match01", "three\n"], ["match02", "four\n"]]) {
      check(new TextDecoder().decode(await fs.readFile('/' + name)) === expected, "csplit regex output " + name);
    }
    const invalid = await shell.exec("csplit - $'\\xff' $'\\xfe'");
    check(invalid.exitCode === 1 && invalid.stderr.includes("\\377"), "csplit shell-created raw argv diagnostic");
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments(["-", shellValueFromBytes(Uint8Array.of(50))]);
  const context = { command: "csplit", args: carrier.args, argumentValues: carrier, cwd: "/", env: { LC_ALL: "C" }, fs,
    stdin: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(255, 10, 254, 10); } }, signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } };
  check((await createCsplitCommand().execute(context)).exitCode === 0, "csplit canonical value identity");
  let identity;
  const reportingFailure = new Error("blocked diagnostic sink");
  try { await createCsplitCommand().execute({ ...context, args: [...carrier.args],
    stderr: { async write() { throw reportingFailure; } },
  }); } catch (error) { identity = error; }
  check(identity instanceof AggregateError && identity.errors[0] instanceof CommandArgumentIdentityError && identity.errors[1] === reportingFailure, "csplit canonical argument error identity");
  const reason = new FsError("EIO", "/output", "packed sink failure");
  let diagnostic = "";
  const failure = await createCsplitCommand().execute({ ...context,
    stdout: { async write() { throw reason; } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } },
  });
  check(failure.exitCode === 1 && diagnostic === "csplit: Input/output error\n", "csplit canonical filesystem error classification");
  const controller = new AbortController(); controller.abort(reason);
  let cancellation;
  try { await createCsplitCommand().execute({ ...context, signal: controller.signal }); } catch (error) { cancellation = error; }
  check(cancellation === reason, "csplit cancellation identity");
  const limitedFs = new MemoryFileSystem();
  check((await createCsplitCommand({ limits: { maxFiles: 1 } }).execute({ ...context, fs: limitedFs })).exitCode === 1, "csplit explicit file limit");
  check(!(await limitedFs.readdir("/")).some(entry => entry.name === "xx00" || entry.name === "xx01"), "csplit failure cleanup");
})();
