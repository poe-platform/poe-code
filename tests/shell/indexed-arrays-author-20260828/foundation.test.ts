import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { basicCommands } from "../../../src/commands/basic.js";
import { ArrayLedger, ArrayOwner } from "../../../src/shell/arrays/ledger.js";
import { BindingStore } from "../../../src/shell/arrays/bindings.js";
import { arrayStore, requireArrays, snapshotState, trackState } from "../../../src/shell/arrays/state.js";
import { InvocationScope } from "../../../src/shell/cleanup.js";
import type { State } from "../../../src/shell/runtime.js";

let publicExecs = 0;
class AuthorShell extends Shell {
  override exec(...args: Parameters<Shell["exec"]>): ReturnType<Shell["exec"]> {
    publicExecs++;
    return super.exec(...args);
  }
}
test.after(() => { process.stdout.write(`AUTHOR_FLOW_COUNTS ${JSON.stringify({ publicExecs })}\n`); });

function shell(): Shell {
  const result = new AuthorShell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) if (command.name === "printf" || command.name === "echo") result.register(command);
  return result;
}

async function output(source: string, expected: string, status = 0): Promise<void> {
  const instance = shell();
  try {
    const result = await instance.exec(source);
    assert.equal(result.stdout, expected, source + "\n" + result.stderr);
    assert.equal(result.exitCode, status, source + "\n" + result.stderr);
    if (status === 0 && !source.includes("||")) assert.equal(result.stderr, "", source);
  } finally { await instance.dispose(); }
}

test("foundation: sparse assignment, append and distinct zero views", { timeout: 5000 }, async () => {
  await output('a=([9]=nine [0]="" [2147483647]=max); printf "<%s>" "${a[@]}"; printf "/%s/%s/%s" "${#a[@]}" "${a-absent}" "${a:-empty}"', "<><nine><max>/3//empty");
  await output('a=(A B); a+=([5]=F G); a[0]+=Z; a+=([1]=Q); printf "<%s>" "${a[@]}"', "<AZ><Q><F><G>");
  await output('a=scalar; a[3]=three; printf "<%s>" "${a[@]}"; a=(); printf "/%s/%s" "${#a[@]}" "${a-missing}"', "<scalar><three>/0/missing");
});

test("foundation: repeated aggregate splice, quotes, IFS and empty fragments", { timeout: 5000 }, async () => {
  await output('a=(A B); b=(C D); printf "<%s>" "${a[@]}:${b[@]}"', "<A><B:C><D>");
  await output('a=(); printf "<%s>" pre"${a[@]}"post; printf "/%s" "${#a[@]}"', "<prepost>/0");
  await output('a=(A B); IFS="💡x"; printf "<%s>" "${a[*]}"; IFS=; printf "<%s>" "${a[*]}"', "<A💡B><AB>");
  await output('a=("A B" "" C); printf "<%s>" ${a[@]}', "<A><B><C>");
});

test("foundation: supported lazy bare operators preserve scalar behavior", { timeout: 5000 }, async () => {
  for (const initial of ['a=([4]=four)', 'unset a']) {
    await output(`${initial}; printf "<%s>" "${'${a:=zero}'}" "${'${a:+yes}'}" "${'${a:-no}'}" "${'${a#z}'}" "${'${a/er/X}'}" "${'${#a}'}"`, "<zero><yes><zero><ero><zXo><4>");
  }
  await output('a=(yes); printf "%s" "${a:-${side:=bad}}" "${side-unset}"', "yesunset");
});

test("foundation: static overflow suppresses RHS, dynamic zero arity does not consume", { timeout: 5000 }, async () => {
  await output('a=([2147483647]=max); a+=(${side:=bad} literal) || printf "failed:"; printf "%s/%s" "${side-unset}" "${a[2147483647]}"', "failed:bad/max");
  await output('a=([2147483647]=${side:=bad} next) || printf "failed:"; printf "%s" "${side-unset}"', "failed:unset");
  await output('a=([2147483647]=max); a+=($missing); printf "%s/%s" "${#a[@]}" "${a[2147483647]}"', "1/max");
});

test("foundation: syntax refusal includes inactive branches and ordinary argv remains literal", { timeout: 5000 }, async () => {
  await output('false && a[01]=bad', "", 2);
  await output('a=(x) echo nope', "", 2);
  await output('printf "%s" "a[1]=x"', "a[1]=x");
  await output('printf "%s" a[01]=x', "a[01]=x");
  await output('printf "%s" "${a[0]:-x}"', "", 2);
});

test("foundation: element/aggregate unset retains kind; whole unset removes it", { timeout: 5000 }, async () => {
  await output('a=([1]=x [2147483647]=y); unset "a[2147483647]"; a+=(z); printf "<%s>" "${a[@]}"; unset "a[@]"; a=zero; printf "/%s/%s" "${#a[@]}" "$a"', "<x><z>/1/zero");
  await output('a=(x); unset a; a=scalar; printf "%s" "$a"', "scalar");
});

test("foundation: readonly, export phases and typed local restoration", { timeout: 5000 }, async () => {
  await output('a=([3]=outer); f() { local a=inner; a[8]=tail; printf "<%s>" "${a[@]}"; readonly a; }; f; printf "<%s>" "${a[@]}"', "<inner><tail><outer>");
  await output('a=(x y); readonly a=zero; a[0]=bad || printf "refused:"; printf "<%s>" "${a[@]}"', "refused:<zero><y>");
  await output('export a=scalar; a=(${side:=bad}) || printf "refused:"; printf "%s/%s" "$a" "${side-unset}"', "refused:scalar/unset");
  await output('a=(x); export a=bad || printf "refused:"; printf "%s" "$a"', "refused:x");
  await output('a=outer; f() { local a=inner; a=(typed tail); }; f; printf "%s/%s" "$a" "${#a[@]}"', "outer/1");
});

test("foundation: clones, functions, eval and fresh public exec", { timeout: 5000 }, async () => {
  await output('a=(outer tail); (a[0]=child; printf "%s/" "$a"); printf "%s/" "$a"; eval "a[1]=changed"; printf "%s" "${a[1]}"', "child/outer/changed");
  const instance = shell();
  try {
    assert.equal((await instance.exec('a=(first); printf "%s" "$a"')).stdout, "first");
    assert.equal((await instance.exec('printf "%s" "${a-unset}"')).stdout, "unset");
  } finally { await instance.dispose(); }
});

test("private ledger: seven formulas, atomic refusal and cumulative nonrefund", () => {
  const ledger = new ArrayLedger(100, 10);
  const admitted = ledger.reserve({ wrappers: 1, slots: 1, payload: 10, metadata: 32, generation: true, version: true, epoch: true, work: 8 });
  assert.deepEqual(ledger.snapshot().caps, [10, 10, 100, 1280, 5920, 80, 5760]);
  assert.deepEqual([admitted.generation, admitted.version, admitted.epoch], [1, 2, 3]);
  const before = ledger.snapshot();
  assert.throws(() => ledger.reserve({ wrappers: 11, payload: 101, epoch: true }), /private wrapper limit/u);
  assert.deepEqual(ledger.snapshot(), before);
  admitted.release();
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(ledger.snapshot().used.slice(4), before.used.slice(4));
  assert.equal(ledger.snapshot().lastIssued, 3);
});

test("private ledger: shared near-end ticket cursor commits atomically", () => {
  const ledger = new ArrayLedger(100, 10, Number.MAX_SAFE_INTEGER - 2);
  const before = ledger.snapshot();
  assert.throws(() => ledger.reserve({ generation: true, version: true, epoch: true }), /private epoch capacity exhausted/u);
  assert.deepEqual(ledger.snapshot(), before);
  const admitted = ledger.reserve({ generation: true, version: true });
  assert.equal(admitted.generation, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(admitted.version, Number.MAX_SAFE_INTEGER);
  assert.throws(() => ledger.reserve({ epoch: true }), /private epoch capacity exhausted/u);
});

test("foundation: typed middleware shadows and scalar restoration remain distinct", { timeout: 5000 }, async () => {
  for (const write of [false, true]) {
    const instance = shell();
    instance.use(async (context, next) => {
      if (context.command === "f") context.env.a = "overlay";
      return next();
    });
    try {
      const result = await instance.exec(`a=([3]=outer); f() { printf "%s/" "$a"; ${write ? "a=overlay;" : ""} }; f; printf "%s/%s" "$a" "${'${a[3]-missing}'}"`);
      assert.equal(result.exitCode, 2);
      const valid = await instance.exec(`a=([3]=outer); f() { printf "%s/" "$a"; ${write ? "a=overlay;" : ""} }; f; printf "%s/%s" "$a" "${'${a[3]}'}"`);
      assert.equal(valid.stderr, "");
      assert.equal(valid.stdout, write ? "overlay/overlay/" : "overlay//outer");
    } finally { await instance.dispose(); }
  }
  const instance = shell();
  instance.use(async (context, next) => { if (context.command === "f") context.env.a = "B"; return next(); });
  try { assert.equal((await instance.exec('a=A; f() { a=B; }; f; printf "%s" "$a"')).stdout, "A"); }
  finally { await instance.dispose(); }
});

test("foundation: internal invoke keeps arrays unless explicit scalar env shadows them", { timeout: 5000 }, async () => {
  const instance = shell();
  instance.register({ name: "nested", async execute(context) {
    await context.invoke!("eval", ['printf "<%s>" "${a[@]}"']);
    await context.invoke!("eval", ['printf "<%s>" "$a"'], { env: { a: "shadow" }, replaceEnv: true });
    return { exitCode: 0 };
  } });
  try {
    const result = await instance.exec('a=(outer tail); nested; printf "<%s>" "${a[@]}"');
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "<outer><tail><shadow><outer><tail>");
  } finally { await instance.dispose(); }
});

test("private state: whole-state epoch rejects interleaved dotglob snapshot", { timeout: 2000 }, async () => {
  const scope = new InvocationScope();
  const raw: State = { cwd: "/", variables: Object.assign(Object.create(null) as Record<string, string>, { long: "x".repeat(300) }), exported: new Set(), functions: new Map(), positional: [], status: 0, substitutionStatus: 0, depth: 0, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false };
  const state = trackState(raw, { limits: { maxExpansionBytes: 10000, maxExpansionFields: 1000 } }, scope);
  requireArrays(state);
  const before = arrayStore(state)!.epoch;
  const pending = snapshotState(state, () => ({ ...state, variables: { ...state.variables } }), new AbortController().signal);
  state.dotglob = true;
  assert.notEqual(arrayStore(state)!.epoch, before);
  await assert.rejects(pending, /stale state snapshot/u);
  await scope.close();
  assert.deepEqual(scope.failures, []);
});

test("foundation: staged RHS mutation preserves live effects and refuses stale publication", { timeout: 5000 }, async () => {
  await output('a=([2]=old); a=(${a:=side}) || printf "stale:"; printf "<%s>" "${a[@]}"', "stale:<side><old>");
  await output('a=([2147483647]=${side:=bad} "$missing") || printf "overflow:"; printf "%s" "${side-unset}"', "overflow:unset");
});

test("foundation: scalar overlay is permanently superseded only by successful typed publication", { timeout: 5000 }, async () => {
  const instance = shell();
  instance.use(async (context, next) => { if (context.command === "f") context.env.a = "B"; return next(); });
  try {
    const result = await instance.exec('a=A; f() { unset a; a=(new); unset a; a=B; }; f; printf "%s" "$a"');
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "B");
  } finally { await instance.dispose(); }
});

test("private ownership: root close drains admitted cooperative work before resources", { timeout: 2000 }, async () => {
  const ledger = new ArrayLedger(1000, 100);
  const owner = ArrayOwner.create(ledger);
  const holding = owner.hold();
  const payload = owner.reserve({ payload: 25, metadata: 32, work: 4 });
  let settled = false;
  const pending = owner.close().then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(payload.released, false);
  holding.release();
  await pending;
  assert.equal(payload.released, true);
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

test("foundation: actual public zero B/F limits retain scalar-only execution", { timeout: 5000 }, async () => {
  const instance = shell();
  try {
    assert.equal((await instance.exec("scalar=", { limits: { maxExpansionBytes: 0, maxExpansionFields: 1 } })).exitCode, 0);
    const bytes = await instance.exec("a=()", { limits: { maxExpansionBytes: 0 } });
    assert.equal(bytes.exitCode, 1);
    assert.match(bytes.stderr, /private payload limit/u);
    const fields = await instance.exec("a=()", { limits: { maxExpansionFields: 1 } });
    assert.equal(fields.exitCode, 1);
    assert.match(fields.stderr, /private Map slot limit/u);
  } finally { await instance.dispose(); }
});

test("foundation: actual default public expansion B/F boundaries", { timeout: 5000 }, async () => {
  const instance = shell();
  try {
    const fieldSource = `values='${"x ".repeat(10001)}'; a=($values)`;
    await assert.rejects(instance.exec(fieldSource), (error: unknown) => error instanceof Error && "limit" in error && error.limit === "maxExpansionFields");
    const byteSource = `value='${"x".repeat(65536)}'; a[0]="${"$value".repeat(257)}"`;
    await assert.rejects(instance.exec(byteSource), (error: unknown) => error instanceof Error && "limit" in error && error.limit === "maxExpansionBytes");
  } finally { await instance.dispose(); }
});

test("foundation: caller identity wins without waiting for opaque registered work", { timeout: 2000 }, async () => {
  for (const reason of [0, new Error("array caller")]) {
    const instance = shell();
    let entered!: () => void;
    const entry = new Promise<void>(resolve => { entered = resolve; });
    instance.register({ name: "opaque", execute() { entered(); return new Promise<never>(() => undefined); } });
    const controller = new AbortController();
    const pending = instance.exec('a=(owned); opaque "${a[@]}"', { signal: controller.signal });
    const rejected = assert.rejects(pending, error => Object.is(error, reason));
    await entry;
    controller.abort(reason);
    await rejected;
    await instance.dispose();
  }
});

test("foundation: awaited backpressure and reused byte ownership survive array argv", { timeout: 2000 }, async () => {
  const instance = shell();
  instance.register({ name: "binary", async execute(context) {
    const bytes = new Uint8Array([0, 255]);
    await context.stdout.write(bytes);
    bytes.fill(7);
    await context.stdout.write(bytes);
    return { exitCode: 0 };
  } });
  let writes = 0;
  try {
    const result = await instance.exec('a=(x); binary "${a[@]}"', { stdout: { async write() { await new Promise<void>(resolve => setImmediate(resolve)); writes++; } } });
    assert.deepEqual(result.stdoutBytes, new Uint8Array([0, 255, 7, 7]));
    assert.equal(writes, 2);
  } finally { await instance.dispose(); }
});

test("foundation: function inline-input snapshots preserve typed reads and zero writes", { timeout: 5000 }, async () => {
  await output('a=([1]=one); f() { read line; printf "%s/%s" "$line" "${a[1]}"; }; x=prefix f <<< "${a[@]}"', "one/one");
  await output('a=([1]=one); f() { read line; printf "%s/%s" "$line" "$a"; }; x=prefix f <<< "${a:=zero}"', "zero/zero");
});

test("foundation: retained scalar LET, CD, STACK and DOTGLOB workflows", { timeout: 5000 }, async () => {
  const instance = shell();
  instance.register({ name: "setup", async execute(context) {
    await context.fs.mkdir("/work");
    await context.fs.mkdir("/other");
    await context.fs.writeFile("/work/.hidden", new Uint8Array());
    await context.fs.writeFile("/work/visible", new Uint8Array());
    return { exitCode: 0 };
  } });
  try {
    const result = await instance.exec('setup; a=(start); let "scalar=2+3"; cd /work; shopt -s dotglob; a=(*); printf "<%s>" "${a[@]}"; pushd /other > /stack-output; popd > /stack-output; printf "/%s/%s" "$PWD" "$scalar"');
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "<.hidden><visible>//work/5");
  } finally { await instance.dispose(); }
});

test("foundation: private refusal preserves escaping diagnostic sink error", { timeout: 2000 }, async () => {
  const instance = shell();
  const failure = new Error("array diagnostic sink");
  try {
    await assert.rejects(instance.exec("a[2147483648]=bad", { stderr: { write() { throw failure; } } }), error => error === failure);
  } finally { await instance.dispose(); }
});

test("private ledger: last observer retires, ABA gets fresh tickets, overlapping close single-flights", { timeout: 2000 }, async () => {
  const ledger = new ArrayLedger(1000, 100);
  const owner = ArrayOwner.create(ledger);
  const store = BindingStore.create(owner);
  const operation = ArrayOwner.create(ledger, owner);
  const signal = new AbortController().signal;
  const first = await store.watch("absent", operation, signal);
  const second = await store.watch("absent", operation, signal);
  assert.equal(store.watches.size, 1);
  first.close();
  assert.equal(store.watches.size, 1);
  second.close();
  assert.equal(store.watches.size, 0);
  const third = await store.watch("absent", operation, signal);
  assert.notEqual(third.generation, first.generation);
  const closing = owner.close();
  assert.equal(owner.close(), closing);
  await closing;
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});
