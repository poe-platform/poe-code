import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Shell, agentCommands, createMemoryFileSystem, createReadOnlyFileSystem,
  archiveCommands, fileCommands, streamFormatCommands, streamInspectionCommands,
  structuredCommands, textProgramCommands, type FileSystem, type FsOptions,
} from "../../src/index.js";
import { yqCommands } from "../../src/commands/yq/index.js";

async function fixture(mode: "disabled" | "absent", readOnly = false, beforeQuery?: (path: string, options?: FsOptions) => Promise<void>) {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input.txt", new TextEncoder().encode("first\nsecond\n"));
  await memory.writeFile("/input.json", new TextEncoder().encode('{"name":"ok"}\n'));
  await memory.writeFile("/input.yaml", new TextEncoder().encode("name: ok\n"));
  await memory.writeFile("/filter.jq", new TextEncoder().encode(".name"));
  await memory.mkdir("/out");
  await memory.mkdir("/dev");
  await memory.writeFile("/dev/null", new TextEncoder().encode("historical backing row"));
  const backing = readOnly ? createReadOnlyFileSystem(memory) : memory;
  const reads: { path: string; maxBytes: number | undefined }[] = [];
  const queries: string[] = [];
  const traps: string[] = [];
  const writes: string[] = [];
  const capabilities = { ...backing.capabilities, streamingRead: true, streamingWrite: true, retainedRead: true };
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return capabilities;
      if (property === "capabilitiesFor") return async (path: string, options?: FsOptions) => {
        options?.signal?.throwIfAborted();
        queries.push(path);
        await beforeQuery?.(path, options);
        return mode === "absent" ? capabilities : {
          ...capabilities, streamingRead: false, streamingWrite: false, retainedRead: false,
        };
      };
      if (property === "readStream" || property === "writeStream" || property === "openReadFile") {
        return mode === "absent" ? undefined : () => {
          traps.push(property);
          throw new Error(`disabled ${property} called`);
        };
      }
      if (property === "readFile") return async (...args: Parameters<FileSystem["readFile"]>) => {
        reads.push({ path: args[0], maxBytes: args[1]?.maxBytes });
        return target.readFile(...args);
      };
      if (property === "writeFile" || property === "appendFile") return async (...args: Parameters<FileSystem["writeFile"]>) => {
        writes.push(args[0]);
        return target[property](...args);
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const shell = new Shell({ fs }).use(agentCommands()).use(yqCommands());
  return { shell, memory, reads, queries, traps, writes };
}

const ordinaryCases = [
  ["jq", "jq -r -f /filter.jq /input.json", "ok\n"],
  ["yq", "yq -o json -r .name /input.yaml", "ok\n"],
  ["file", "file -b --mime-type /input.txt", "text/plain\n"],
  ["tac", "tac /input.txt", "second\nfirst\n"],
  ["nl", "nl -ba /input.txt", "     1\tfirst\n     2\tsecond\n"],
  ["awk", 'awk \'BEGIN { getline line < "/input.txt"; print line }\'', "first\n"],
] as const;

for (const mode of ["disabled", "absent"] as const) {
  for (const [name, command, stdout] of ordinaryCases) {
    test(`${mode}: ${name} uses the existing capped ordinary-file fallback`, async () => {
      const state = await fixture(mode);
      try {
        const result = await state.shell.exec(command);
        assert.equal(result.exitCode, 0, `${result.stderr}; traps=${JSON.stringify(state.traps)}`);
        assert.equal(result.stdout, stdout);
        assert.deepEqual(state.traps, []);
        assert.ok(state.reads.length > 0);
        for (const read of state.reads) {
          assert.ok(state.queries.includes(read.path), read.path);
          assert.ok(Number.isSafeInteger(read.maxBytes) && read.maxBytes! > 0, read.path);
        }
      } finally { await state.shell.dispose(); }
    });
  }

  test(`${mode}: tar reads and publishes ordinary files without disabled streams`, async () => {
    const state = await fixture(mode);
    try {
      for (const command of ["tar -cf /bundle.tar /input.txt", "tar -tf /bundle.tar", "tar -xf /bundle.tar -C /out"]) {
        const result = await state.shell.exec(command);
        assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
      }
      assert.equal(new TextDecoder().decode(await state.memory.readFile("/out/input.txt")), "first\nsecond\n");
      assert.deepEqual(state.traps, []);
      assert.ok(state.queries.includes("/out/input.txt"));
      assert.ok(state.writes.includes("/out/input.txt"));
      assert.ok(state.reads.every(read => Number.isSafeInteger(read.maxBytes) && read.maxBytes! > 0));
    } finally { await state.shell.dispose(); }
  });

  test(`${mode}: null workflows bypass disabled backing streams and retain the masked row`, async () => {
    const state = await fixture(mode);
    try {
      for (const command of ["jq -R . /dev/null", "yq -o json . /dev/null", "tac /dev/null", "nl /dev/null", 'awk \'BEGIN { print (getline line < "/dev/null") }\'', "file -b --mime-type /dev/null", "tar -cf - /input.txt > /dev/null"]) {
        const result = await state.shell.exec(command);
        assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
        assert.equal(result.stdout, command.startsWith("awk") ? "0\n" : command.startsWith("file") ? "inode/chardevice\n" : "");
      }
      assert.deepEqual(state.traps, []);
      assert.ok(state.reads.every(read => read.path !== "/dev/null"));
      assert.ok(state.writes.every(path => path !== "/dev/null"));
      assert.equal(new TextDecoder().decode(await state.memory.readFile("/dev/null")), "historical backing row");
    } finally { await state.shell.dispose(); }
  });

  test(`${mode}: ordinary read-only writes still fail while null output drains`, async () => {
    const state = await fixture(mode, true);
    try {
      const refused = await state.shell.exec("tar -cf /bundle.tar /input.txt");
      assert.notEqual(refused.exitCode, 0);
      await assert.rejects(state.memory.stat("/bundle.tar"), { code: "ENOENT" });
      const discarded = await state.shell.exec("tar -cf - /input.txt > /dev/null");
      assert.equal(discarded.exitCode, 0, discarded.stderr);
      assert.deepEqual(state.traps, []);
    } finally { await state.shell.dispose(); }
  });
}

test("disabled: capped fallbacks keep rejecting oversized inputs", async () => {
  const state = await fixture("disabled");
  try {
    state.shell.use(structuredCommands({ replace: true, limits: { maxSourceBytes: 2 } }))
      .use(fileCommands({ replace: true, limits: { maxReadFileBytes: 2 } }))
      .use(streamInspectionCommands({ replace: true, limits: { maxInputBytes: 2 } }))
      .use(streamFormatCommands({ replace: true, limits: { maxInputBytes: 2 } }))
      .use(textProgramCommands({ replace: true, maxBufferBytes: 2 }))
      .use(archiveCommands({ replace: true, limits: { maxBufferedFileBytes: 2 } }));
    for (const command of ["jq -f /filter.jq /input.json", "file /input.txt", "tac /input.txt", "nl /input.txt", 'awk \'BEGIN { getline line < "/input.txt"; print line }\'', "tar -cf /bundle.tar /input.txt"]) {
      const result = await state.shell.exec(command);
      assert.notEqual(result.exitCode, 0, command);
    }
    assert.deepEqual(state.traps, []);
  } finally { await state.shell.dispose(); }
});

for (const [name, command] of [...ordinaryCases, ["tar", "tar -cf /bundle.tar /input.txt"]] as const) {
  test(`disabled: ${name} cancellation during capability admission does not start fallback I/O`, async () => {
    const controller = new AbortController();
    let entered!: () => void;
    let release!: () => void;
    const admitted = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    let active = 0;
    const state = await fixture("disabled", false, async (_path, options) => {
      assert.ok(options?.signal);
      active++;
      entered();
      try { await pending; }
      finally { active--; }
    });
    try {
      const running = state.shell.exec(command, { signal: controller.signal });
      const reason = new Error("cancel capability admission");
      const rejected = assert.rejects(running, error => error === reason);
      await admitted;
      controller.abort(reason);
      release();
      await rejected;
      assert.equal(active, 0);
      assert.deepEqual(state.traps, []);
      assert.deepEqual(state.reads, []);
      assert.deepEqual(state.writes, []);
    } finally { release(); await state.shell.dispose(); }
  });
}
