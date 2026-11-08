import { Shell, createExprCommand as rootCommand, createExprCommands as rootCommands, exprCommands as rootPlugin } from "@poe-platform/safe-bash";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createExprCommand, createExprCommands, exprCommands } from "@poe-platform/safe-bash/commands/expr";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createExprCommand && rootCommands === createExprCommands && rootPlugin === exprCommands, "expr public factory identity");
  check(JSON.stringify(createExprCommands().map(command => command.name)) === '["expr"]', "expr inventory");
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(exprCommands());
  try {
    await shell.exec("expr 1");
    const host = { commands: shell.commands, use() {}, registerFileSystem() {} };
    const original = shell.commands.get("expr");
    let collision;
    try { await exprCommands().setup(host); } catch (error) { collision = error; }
    check(collision && shell.commands.get("expr") === original, "expr collision preserves registration");
    await exprCommands({ replace: true }).setup(host);
    check(shell.commands.get("expr") !== original, "expr explicit replacement");
    shell.commands.register({ name: "relay", async execute(context) {
      for await (const chunk of context.stdin) await context.stdout.write(chunk);
      return { exitCode: 0 };
    } });
    await fs.writeFile("/expr.sh", new TextEncoder().encode('expr "$1" = "$2"\nexpr substr "$1" 1 1 | relay\n'));
    const result = await shell.exec("sh /expr.sh $'\\xff' $'\\xfe'");
    check(result.exitCode === 0 && result.stderr === "" && JSON.stringify([...result.stdoutBytes]) === '[48,10,255,10]', "expr VFS script, byte argv and pipeline");
    for (const [script, stdout, status] of [["expr 2 + 3 '*' 4", "14\n", 0], ["expr abc : 'a\\(.\\)c'", "b\n", 0], ["expr 0", "0\n", 1], ["expr 1 / 0", "", 2]]) {
      const actual = await shell.exec(script);
      check(actual.stdout === stdout && actual.exitCode === status, `expr behavior: ${script}`);
    }
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  let output = [];
  const context = { command: "expr", args: carrier.args, argumentValues: carrier, cwd: "/", env: { LC_ALL: "C" }, fs,
    stdin: { async *[Symbol.asyncIterator]() {} }, signal: new AbortController().signal,
    stdout: { async write(chunk) { output.push(...chunk); } }, stderr: { async write() {} } };
  check((await createExprCommand().execute(context)).exitCode === 0 && JSON.stringify(output) === '[255,10]', "expr canonical value identity");
  let identity;
  try { await createExprCommand().execute({ ...context, args: [...carrier.args] }); } catch (error) { identity = error; }
  check(identity instanceof CommandArgumentIdentityError, "expr canonical argument error identity");
  const reason = new FsError("EIO", "/output", "packed sink failure");
  let failure;
  try { await createExprCommand().execute({ ...context, stdout: { async write() { throw reason; } } }); } catch (error) { failure = error; }
  check(failure === reason && failure instanceof FsError, "expr sink error identity");
  const controller = new AbortController(); controller.abort(reason);
  let cancellation;
  try { await createExprCommand().execute({ ...context, signal: controller.signal }); } catch (error) { cancellation = error; }
  check(cancellation === reason, "expr cancellation identity");
  output = [];
  check((await createExprCommand({ limits: { maxOutputBytes: 1 } }).execute(context)).exitCode === 3 && output.length === 0, "expr explicit output limit");
})();
