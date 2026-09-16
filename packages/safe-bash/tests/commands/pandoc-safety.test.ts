import assert from "node:assert/strict";
import test from "node:test";
import {Shell} from "../../src/shell/index.js";
import {FsError, type FileSystem} from "../../src/contracts/index.js";
import {pandocCommands} from "../../src/commands/pandoc/index.js";
import {fixture} from "./pandoc-fixture.js";

function override(fs: FileSystem, changes: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, {get(target, key) {
    const value: unknown = Object.hasOwn(changes, key) ? Reflect.get(changes, key) : Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }});
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {resolve = yes;});
  return {promise, resolve};
}

test("pandoc refuses unknown existing output identity before reading or writing", async () => {
  const {fs, volume, shell: initial} = fixture();
  let reads = 0;
  const stat: FileSystem["stat"] = async (path, options) => {
    const value = await fs.stat(path, options);
    return {type: value.type, size: value.size, mode: value.mode, mtimeMs: value.mtimeMs, atimeMs: value.atimeMs, ctimeMs: value.ctimeMs};
  };
  const shell = new Shell({fs: override(fs, {stat, lstat: stat, async readFile() {reads++; throw new Error("must not read");}}), cwd: "/work"}).use(pandocCommands());
  try {
    const result = await shell.exec("pandoc -f commonmark -t plain b.md -o out");
    assert.equal(result.exitCode, 9, result.stderr);
    assert.equal(reads, 0);
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose(); await initial.dispose();}
});

test("pandoc refuses -o on providers lacking atomic publication without acquiring input", async () => {
  const {fs, volume, shell: initial} = fixture();
  const shell = new Shell({fs: override(fs, {capabilities: {...fs.capabilities, atomicFileMutation: false}}), cwd: "/work"}).use(pandocCommands());
  try {
    const result = await shell.exec("pandoc -f commonmark -t plain -o out", {stdin: {async *[Symbol.asyncIterator]() {assert.fail("input acquired"); yield new Uint8Array();}}});
    assert.equal(result.exitCode, 3, result.stderr);
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose(); await initial.dispose();}
});

test("pandoc rejects command output aliasing redirected stdin", async () => {
  const {shell, volume} = fixture();
  try {
    const result = await shell.exec("pandoc -f commonmark -t plain -o b.md < b.md");
    assert.equal(result.exitCode, 9, result.stderr);
    assert.equal(volume.readFileSync("/work/b.md", "utf8"), "Beta");
  } finally {await shell.dispose();}
});

test("pandoc distinguishes filename stdin from stdin provenance", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/stdin", "Named");
  try {
    const result = await shell.exec("pandoc -f commonmark -t plain stdin -o stdin");
    assert.equal(result.exitCode, 9, result.stderr);
    assert.equal(volume.readFileSync("/work/stdin", "utf8"), "Named");
  } finally {await shell.dispose();}
});

test("pandoc preserves shell redirection truncation separately from -o validation", async () => {
  const {shell, volume} = fixture();
  try {
    const result = await shell.exec("pandoc --invalid > out");
    assert.equal(result.exitCode, 2);
    assert.equal(volume.readFileSync("/work/out", "utf8"), "");
  } finally {await shell.dispose();}
});

test("pandoc reports filesystem errors without changing destination", async () => {
  const {fs, volume, shell: initial} = fixture();
  for (const changes of [
    {readFile: async () => {throw new FsError("EACCES", {path: "/work/b.md"});}},
    {writeFileConditional: async () => {throw new FsError("EIO", {path: "/work/out"});}}
  ]) {
    const shell = new Shell({fs: override(fs, changes), cwd: "/work"}).use(pandocCommands());
    try {
      const result = await shell.exec("pandoc -f commonmark -t plain b.md -o out");
      assert.equal(result.exitCode, 9, result.stderr);
      assert.match(result.stderr, /E_IO:/);
      assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
    } finally {await shell.dispose();}
  }
  await initial.dispose();
});

test("pandoc rejects malformed retained byte argv instead of decoding replacement paths", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/�", "Wrong");
  try {
    const result = await shell.exec("pandoc -f commonmark -t plain \"$(printf '\\377')\" -o out");
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /E_OPTION:/);
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose();}
});

for (const method of ["readFile", "writeFileConditional"] as const) {
  test(`pandoc abort drains admitted deferred ${method} before shell settlement`, async () => {
    const {fs, volume, shell: initial} = fixture();
    const entered = deferred<void>(), release = deferred<void>();
    let completed = false;
    const changes: Partial<FileSystem> = method === "readFile" ? {
      async readFile(path, options) {entered.resolve(); await release.promise; completed = true; return fs.readFile(path, options);}
    } : {
      async writeFileConditional(path, bytes, options) {entered.resolve(); await release.promise; completed = true; return fs.writeFileConditional!(path, bytes, options);}
    };
    const shell = new Shell({fs: override(fs, changes), cwd: "/work"}).use(pandocCommands());
    const controller = new AbortController();
    let settled = false;
    const execution = shell.exec("pandoc -f commonmark -t plain b.md -o out", {signal: controller.signal});
    const observed = execution.then(() => {settled = true;}, () => {settled = true;});
    try {
      await entered.promise;
      controller.abort(new Error("cancel conversion"));
      await Promise.resolve();
      assert.equal(settled, false);
      release.resolve();
      await observed;
      assert.equal(completed, true);
      assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
    } finally {release.resolve(); await observed; await shell.dispose(); await initial.dispose();}
  });
}

test("pandoc obeys aggregate shell input budget and early downstream closure", async () => {
  const {shell} = fixture();
  try {
    await assert.rejects(shell.exec("pandoc -f commonmark -t plain 'a b.md' b.md", {limits: {maxInputBytes: 7}}), /maxInputBytes/);
    const piped = await shell.exec("pandoc -f commonmark -t plain 'a b.md' b.md | head -c 1");
    assert.equal(piped.stdout, "A");
  } finally {await shell.dispose();}
});

test("pandoc information and usage paths never acquire files or publish output", async () => {
  const {fs, volume, shell: initial} = fixture();
  let reads = 0, writes = 0;
  const shell = new Shell({fs: override(fs, {
    async readFile() {reads++; assert.fail("file acquired");},
    async writeFileConditional() {writes++; assert.fail("output acquired");}
  }), cwd: "/work"}).use(pandocCommands());
  try {
    for (const command of ["pandoc --help", "pandoc --version", "pandoc --list-input-formats", "pandoc --help b.md -o out", "pandoc --version b.md -o out", "pandoc -f commonmark -t plain --invalid b.md -o out", "pandoc -f commonmark -t plain - - b.md -o out"])
      await shell.exec(command);
    assert.equal(reads, 0);
    assert.equal(writes, 0);
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose(); await initial.dispose();}
});

test("pandoc warning failure preserves destination while accepted warnings stay on stderr", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/raw.md", "left <b>middle</b> right");
  try {
    const args = "pandoc -f commonmark -t plain --raw-content=retain --lossy raw.md";
    const rejected = await shell.exec(`${args} --fail-if-warnings -o out`);
    assert.notEqual(rejected.exitCode, 0);
    assert.match(rejected.stderr, /E_WARNINGS:/);
    assert.equal(rejected.stdout, "");
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
    const accepted = await shell.exec(args);
    assert.equal(accepted.exitCode, 0, accepted.stderr);
    assert.match(accepted.stderr, /W_RAW_CONTENT:/);
    assert.equal(accepted.stdout, "left <b>middle</b> right\n");
  } finally {await shell.dispose();}
});

test("pandoc denied media and invalid font or style requests never publish output", async () => {
  const {fs, volume, shell: initial} = fixture();
  volume.writeFileSync("/work/image.md", "![unsafe](../secret.png)");
  let published = 0;
  const shell = new Shell({fs: override(fs, {async writeFileConditional() {published++; assert.fail("output published");}}), cwd: "/work"}).use(pandocCommands());
  try {
    for (const command of [
      "pandoc -f commonmark -t html --extract-media media image.md -o out",
      "pandoc -f commonmark -t pdf --pdf-font ../missing.ttf b.md -o out",
      "pandoc -f commonmark -t html --css arbitrary.css b.md -o out"
    ]) {
      const result = await shell.exec(command);
      assert.notEqual(result.exitCode, 0, command);
      assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
    }
    assert.equal(published, 0);
  } finally {await shell.dispose(); await initial.dispose();}
});
