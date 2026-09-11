import assert from "node:assert/strict";
import { test } from "node:test";
import { MockS3Client, S3FileSystem } from "poe-code/safe-fs";
import { Shell, createMemoryFileSystem } from "../../src/index.js";
import { createCommandArguments, toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { shellValueFromBytes, type ShellValue } from "../../src/contracts/value.js";
import { createYqCommand, createYqCommands, yqCommands, type YqCommandsOptions } from "../../src/commands/yq/index.js";

async function run(args: readonly string[], input: string | Uint8Array, options: YqCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "yq", args, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    ...overrides,
  };
  const result = await createYqCommand(options).execute(context);
  return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

for (const backend of ["memory", "s3"] as const) test(`TOML queries and conversions use the supplied ${backend} VFS`, async () => {
  const fs = backend === "memory" ? createMemoryFileSystem()
    : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
  await fs.writeFile("/config.toml", Buffer.from('[package]\nname = "demo"\nversions = [1, 2]\n'));
  const shell = new Shell({ fs }).use(yqCommands());
  try {
    const query = await shell.exec("yq -p toml -o json -r '.package.name' /config.toml");
    assert.equal(query.exitCode, 0, query.stderr);
    assert.equal(query.stdout, "demo\n");
    const converted = await shell.exec("yq --input-format=toml -o json -c . /config.toml");
    assert.equal(converted.exitCode, 0, converted.stderr);
    assert.deepEqual(JSON.parse(converted.stdout), { package: { name: "demo", versions: [1, 2] } });
    const yaml = await shell.exec("yq --input-format toml '.package.name' /config.toml");
    assert.equal(yaml.exitCode, 0, yaml.stderr);
    assert.equal(yaml.stdout, '"demo"\n');
  } finally { await shell.dispose(); }
});

test("TOML keeps YAML markers inside multiline strings and emits an empty root object", async () => {
  assert.deepEqual(await run(["-p", "toml", "-o", "json", "-c", "."], 'text = """\n---\n...\n"""\n'), {
    status: 0, stdout: `${JSON.stringify({ text: "---\n...\n" })}\n`, stderr: "",
  });
  assert.deepEqual(await run(["-p", "toml", "-o", "json", "-c"], ""), { status: 0, stdout: "{}\n", stderr: "" });
});

test("TOML SDK input format is captured and CLI selection overrides it", async () => {
  const options: YqCommandsOptions = { inputFormat: "toml" };
  const plugin = yqCommands(options);
  Object.assign(options, { inputFormat: "yaml" });
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(plugin);
  try {
    const toml = await shell.exec("yq -o json -c .", { stdin: Buffer.from("x = 1\n") });
    assert.equal(toml.exitCode, 0, toml.stderr);
    assert.equal(toml.stdout, '{"x":1}\n');
    const yaml = await shell.exec("yq -p yaml -o json -c .", { stdin: Buffer.from("x: 2\n") });
    assert.equal(yaml.exitCode, 0, yaml.stderr);
    assert.equal(yaml.stdout, '{"x":2}\n');
  } finally { await shell.dispose(); }
  assert.equal(createYqCommands({ inputFormat: "toml" }).length, 1);
});

test("TOML input format validates options before input acquisition", async () => {
  for (const options of [null, { inputFormat: "json" }, { inputFormat: 1 }, { extra: true }]) {
    assert.throws(() => createYqCommand(options as never), TypeError);
    assert.throws(() => yqCommands(options as never), TypeError);
  }
  for (const args of [["-p"], ["--input-format="], ["-p", "unknown"], ["-p", "toml", "--input-format=yaml"]]) {
    let reads = 0;
    const result = await run(args, "", {}, { stdin: (async function* () { reads++; yield Buffer.from("x=1"); })() });
    assert.equal(result.status, 2);
    assert.equal(reads, 0);
  }
});

test("TOML files retain argv order and stdin is a separate document", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/one", Buffer.from("n=1"));
  await fs.writeFile("/three", Buffer.from("n=3"));
  assert.deepEqual(await run(["-p", "toml", "-o", "json", "-c", ".n", "/one", "-", "/three"], "n=2", {}, { fs }), {
    status: 0, stdout: "1\n2\n3\n", stderr: "",
  });
});

test("TOML syntax errors cannot be swallowed by query try", async () => {
  const result = await run(["-p", "toml", "-o", "json", "try . catch 42"], "x = [");
  assert.equal(result.status, 5);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /INPUT_TOML_SYNTAX/);
});

test("TOML rejects malformed UTF-8 before parsing", async () => {
  const result = await run(["-p", "toml"], Uint8Array.of(0xff));
  assert.equal(result.status, 5);
  assert.match(result.stderr, /INPUT_INVALID_UTF8/);
});

test("TOML refuses lossy raw query and filename bytes before reading input", async () => {
  for (const position of [4, 5]) {
    const args: ShellValue[] = ["-p", "toml", "-o", "json", ".", "/replacement"];
    args[position] = shellValueFromBytes(Buffer.from([0xff]));
    const carrier = createCommandArguments(args);
    let reads = 0;
    const fs = new Proxy(createMemoryFileSystem(), { get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (property === "readFile" || property === "readStream") reads++;
        return Reflect.apply(value, target, args);
      };
    } });
    const result = await run(carrier.args, "", {}, { fs, argumentValues: carrier });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CLI_INVALID_UNICODE/);
    assert.equal(reads, 0);
  }
});

test("TOML cancels empty input chunks and drains the source with exact reason", async () => {
  const controller = new AbortController();
  const reason = { cancelled: "empty input" };
  let closed = false, chunks = 0;
  registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
  const stdin = (async function* () {
    try { for (; chunks < 10000; chunks++) yield new Uint8Array(); }
    finally { closed = true; }
  })();
  await assert.rejects(run(["-p", "toml"], "", {}, { stdin, signal: controller.signal }), error => error === reason);
  assert.equal(closed, true);
  assert.ok(chunks < 10000);
});

test("TOML admits document bytes before copying or parsing", async () => {
  const chunk = Buffer.from("x=1");
  Object.defineProperty(chunk, "byteLength", { value: 8_388_609 });
  let closed = false;
  const stdin = (async function* () { try { yield chunk; } finally { closed = true; } })();
  const result = await run(["-p", "toml"], "", {}, { stdin });
  assert.equal(result.status, 5);
  assert.match(result.stderr, /LIMIT_MAX_DOCUMENT_BYTES/);
  assert.equal(closed, true);
});
