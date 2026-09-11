import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/shell.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { ValueArena } from "../../src/shell/value-state.js";

function memory() {
  return new MemoryFileSystem({ maxFileBytes: 65536, maxRetainedBytes: 262144, maxMetadataUnits: 128 });
}

function observeTokens(context: TestContext, pattern: string, materialized?: () => void) {
  const allocate = ValueArena.prototype.allocate;
  const release = ValueArena.prototype.release;
  const from = Array.from;
  const live = new Set<ReturnType<typeof allocate>>();
  const liveAtMaterialization: number[] = [];
  let admissions = 0;
  let materializations = 0;
  context.mock.method(ValueArena.prototype, "allocate", function(this: ValueArena, bytes: number, slots: number) {
    const record = allocate.call(this, bytes, slots);
    if (bytes === 128 + pattern.length * 64 && slots === 0) { live.add(record); admissions++; }
    return record;
  });
  context.mock.method(ValueArena.prototype, "release", function(this: ValueArena, record: Parameters<typeof release>[0]) {
    release.call(this, record);
    live.delete(record);
  });
  context.mock.method(Array, "from", function(input: Iterable<unknown>, ...rest: unknown[]) {
    if (input === pattern) {
      materializations++;
      liveAtMaterialization.push(live.size);
      materialized?.();
    }
    return Reflect.apply(from, Array, [input, ...rest]);
  });
  return { liveAtMaterialization, get admissions() { return admissions; }, get materializations() { return materializations; }, get live() { return live.size; } };
}

const routes = [
  { name: "case", source: 'case $a in "$a") :;; esac', suffix: "" },
  { name: "conditional", source: '[[ $a == "$a" ]]', suffix: "" },
  { name: "glob", source: ': $a*', suffix: "*" },
] as const;

for (const route of routes) {
  test(`${route.name} refuses token storage before materialization under the public Shell limit`, async context => {
    const text = "0".repeat(128);
    const observed = observeTokens(context, text + route.suffix);
    const shell = new Shell({ fs: memory() });
    try {
      await assert.rejects(shell.exec(`a=${text}; ${route.source}`, { limits: { maxExpansionBytes: 4096 } }),
        error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
      assert.equal(observed.admissions, 0);
      assert.equal(observed.materializations, 0);
      assert.equal(observed.live, 0);
    } finally { await shell.dispose(); }
  });

  test(`${route.name} holds admitted tokens until use and releases them before the next command`, async context => {
    const text = "0".repeat(128);
    const observed = observeTokens(context, text + route.suffix);
    const fs = memory();
    await fs.writeFile(`/${text}`, new Uint8Array());
    const readdir = fs.readdir.bind(fs);
    fs.readdir = async (...args) => {
      assert.equal(observed.live, 1, "glob tokens remain admitted during filesystem work");
      return readdir(...args);
    };
    const shell = new Shell({ fs });
    let checked = false;
    shell.register({ name: "check", execute() { assert.equal(observed.live, 0); checked = true; return { exitCode: 0 }; } });
    try {
      const result = await shell.exec(`a=${text}; ${route.source}; check`, { limits: { maxExpansionBytes: 32768 } });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(checked, true);
      assert.equal(observed.admissions, 1);
      assert.equal(observed.materializations, 1);
      assert.deepEqual(observed.liveAtMaterialization, [1]);
      assert.equal(observed.live, 0);
    } finally { await shell.dispose(); }
  });

  test(`${route.name} releases token storage after cancellation without replacing a falsey caller reason`, async context => {
    const text = "0".repeat(128);
    const controller = new AbortController();
    const observed = observeTokens(context, text + route.suffix, () => controller.abort(false));
    const shell = new Shell({ fs: memory() });
    try {
      await assert.rejects(shell.exec(`a=${text}; ${route.source}`, { signal: controller.signal, limits: { maxExpansionBytes: 32768 } }), error => error === false);
      assert.equal(observed.materializations, 1);
      assert.equal(observed.admissions, 1);
      assert.deepEqual(observed.liveAtMaterialization, [1]);
      assert.equal(observed.live, 0);
    } finally { await shell.dispose(); }
  });
}

for (const [name, source] of [
  ["case alternatives", 'case x in "$a") :;; "$a") :;; "$a") :;; esac'],
  ["conditional alternatives", '[[ x == "$a" || x == "$a" || x == "$a" ]]'],
] as const) {
  test(`${name} retire completed matches rather than accumulating token reservations`, async context => {
    const text = "0".repeat(16);
    const observed = observeTokens(context, text);
    const shell = new Shell({ fs: memory() });
    try {
      const result = await shell.exec(`a=${text}; ${source}; :`, { limits: { maxExpansionBytes: 4096 } });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(observed.admissions, 3);
      assert.equal(observed.materializations, 3);
      assert.deepEqual(observed.liveAtMaterialization, [1, 1, 1]);
      assert.equal(observed.live, 0);
    } finally { await shell.dispose(); }
  });
}

test("glob segment admission closes on filesystem failure before shell continuation", async context => {
  const text = "0".repeat(16);
  const observed = observeTokens(context, `${text}*`);
  const fs = memory();
  fs.readdir = async () => { assert.equal(observed.live, 1); throw new Error("synthetic directory failure"); };
  const shell = new Shell({ fs });
  let checked = false;
  shell.register({ name: "check", execute() { assert.equal(observed.live, 0); checked = true; return { exitCode: 0 }; } });
  try {
    const result = await shell.exec(`a=${text}; : $a*; check`);
    assert.equal(result.exitCode, 0);
    assert.equal(checked, true);
    assert.equal(observed.admissions, 1);
    assert.equal(observed.materializations, 1);
    assert.equal(observed.live, 0);
  } finally { await shell.dispose(); }
});

test("parameter trimming retains its existing token admission control", async context => {
  const text = "0".repeat(128);
  const observed = observeTokens(context, text);
  const shell = new Shell({ fs: memory() });
  try {
    await assert.rejects(shell.exec(`a=${text}; : \${a#"$a"}`, { limits: { maxExpansionBytes: 4096 } }),
      error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    assert.equal(observed.materializations, 0);
  } finally { await shell.dispose(); }
});

test("glob segments release their token reservations before compiling the next segment", async context => {
  const text = "0".repeat(16);
  const observed = observeTokens(context, `${text}*`);
  const fs = memory();
  await fs.mkdir(`/${text}`);
  await fs.writeFile(`/${text}/${text}`, new Uint8Array());
  const shell = new Shell({ fs });
  try {
    const result = await shell.exec(`a=${text}; : $a*/$a*`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(observed.admissions, 2);
    assert.deepEqual(observed.liveAtMaterialization, [1, 1]);
    assert.equal(observed.live, 0);
  } finally { await shell.dispose(); }
});

test("glob releases its compiled tokens when directory reading cancels the caller", async context => {
  const text = "0".repeat(16);
  const observed = observeTokens(context, `${text}*`);
  const controller = new AbortController();
  const fs = memory();
  fs.readdir = async () => {
    assert.equal(observed.live, 1);
    controller.abort(false);
    return [];
  };
  const shell = new Shell({ fs });
  try {
    await assert.rejects(shell.exec(`a=${text}; : $a*`, { signal: controller.signal }), error => error === false);
    assert.equal(observed.admissions, 1);
    assert.deepEqual(observed.liveAtMaterialization, [1]);
    assert.equal(observed.live, 0);
  } finally { await shell.dispose(); }
});

test("pattern admission preserves conditional quoting, negation and short circuiting", async () => {
  const shell = new Shell({ fs: memory() });
  try {
    for (const [source, exitCode] of [
      ['[[ ab == a* ]]', 0],
      ['[[ ab == "a*" ]]', 1],
      ['[[ ab != "a*" ]]', 0],
      ['[[ "a*" == "a*" ]]', 0],
      ['[[ "é🙂" == é? ]]', 0],
      ['[[ ab == a* && ab != "a*" ]]', 0],
      ['[[ ab == "a*" || ab == a* ]]', 0],
    ] as const) {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, exitCode, source);
      assert.equal(result.stderr, "", source);
    }
  } finally { await shell.dispose(); }
});
