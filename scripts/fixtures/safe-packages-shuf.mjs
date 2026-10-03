import assert from "node:assert/strict";
import { Shell, createMemoryFileSystem, createShufCommand as rootCommand, agentCommands } from "@poe-platform/safe-bash";
import { createShufCommand, createShufCommands, shufCommands } from "@poe-platform/safe-bash/commands/shuf";
import { createShufCommand as legacyCommand } from "@poe-platform/safe-bash/shuf";
import { createCommandArguments, commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";

export const verification = (async () => {
  for (const factory of [rootCommand, legacyCommand, createShufCommand]) {
    assert.equal(factory().name, "shuf");
    assert.equal(factory().runtimeIdentity, commandRuntimeIdentity);
  }
  assert.deepEqual(createShufCommands().map(command => command.name), ["shuf"]);
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    await fs.writeFile("/random", new Uint8Array(64));
    await fs.writeFile("/shuffle.sh", new TextEncoder().encode('printf "%s\\n" "$1" | shuf --random-source=/random'));
    const bytes = await shell.exec(String.raw`sh /shuffle.sh $'\377'`);
    assert.equal(bytes.exitCode, 0, bytes.stderr);
    assert.deepEqual(bytes.stdoutBytes, Uint8Array.of(255, 10));
    assert.equal(shell.commands.list().filter(command => command.name === "shuf").length, 1);
    const secure = await shell.exec("shuf -i 9007199254740992-18446744073709551615 -n 3");
    assert.equal(secure.exitCode, 0, secure.stderr);
    const selected = secure.stdout.trim().split("\n").map(BigInt);
    assert.equal(selected.length, 3);
    assert.equal(new Set(selected).size, 3);
    assert.ok(selected.every(value => value >= 9007199254740992n && value <= 18446744073709551615n));
    await fs.writeFile("/input.md", new TextEncoder().encode("alpha\n\nbeta\n"));
    await fs.writeFile("/pixel.png", Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6uoAAAAASUVORK5CYII="), character => character.charCodeAt(0)));
    const text = await shell.exec("pandoc -f markdown -t plain /input.md | shuf --random-source=/random");
    assert.equal(text.exitCode, 0, text.stderr);
    assert.equal(text.stderr, "");
    assert.deepEqual(text.stdout.split("\n").filter(Boolean).sort(), ["alpha", "beta"]);
    const image = await shell.exec("sips -g pixelWidth /pixel.png | shuf --random-source=/random");
    assert.equal(image.exitCode, 0, image.stderr);
    assert.equal(image.stderr, "");
    assert.ok(image.stdout.includes("pixelWidth: 1"), image.stdout);
    await fs.mkdir("/scratch");
    const large = new Uint8Array(1_100_002).fill(120);
    large[550_000] = large[large.length - 1] = 10;
    await fs.writeFile("/large", large);
    const streamed = await shell.exec("TMPDIR=/scratch shuf /large -o /large.out --random-source=/random");
    assert.equal(streamed.exitCode, 0, streamed.stderr);
    assert.equal(streamed.stdout, "");
    assert.deepEqual(await fs.readFile("/large.out"), large);
    assert.deepEqual(await fs.readdir("/scratch"), []);
    const original = shell.commands.get("shuf");
    const duplicate = shufCommands();
    assert.throws(() => duplicate.setup({ commands: shell.commands, use() {}, registerFileSystem() {} }), /already registered/);
    assert.equal(shell.commands.get("shuf"), original);
    shell.use(shufCommands({ replace: true }));
    const result = await shell.exec("shuf --random-source=/random -i7-10 -n3");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "7\n8\n9\n", ""]);
    assert.notEqual(shell.commands.get("shuf"), original);
  } finally { await shell.dispose(); }

  const carrier = createCommandArguments(["-e", shellValueFromBytes(Uint8Array.of(255))]);
  const chunks = [];
  const context = { command: "shuf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { LC_ALL: "C" }, fs,
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } }, signal: new AbortController().signal,
    stdout: { async write(bytes) { chunks.push(...bytes); } }, stderr: { async write() {} } };
  assert.equal((await createShufCommand().execute(context)).exitCode, 0);
  assert.deepEqual(chunks, [255, 10]);
  const reason = new FsError("EIO", "/random");
  let diagnostic = "";
  const failure = await createShufCommand().execute({ ...context,
    stdout: { async write() { throw reason; } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  });
  assert.equal(failure.exitCode, 1);
  assert.equal(diagnostic, "shuf: write error: Input/output error\n");
  const controller = new AbortController(); controller.abort(reason);
  await assert.rejects(createShufCommand().execute({ ...context, signal: controller.signal }), error => error === reason);
  const limited = createCommandArguments(["-e", "aa", "bb"]);
  for (const limits of [{ maxInputBytes: 1 }, { maxSampleSize: 1 }]) {
    assert.equal((await createShufCommand({ limits }).execute({ ...context, args: limited.args, argumentValues: limited })).exitCode, 1);
  }
})();
