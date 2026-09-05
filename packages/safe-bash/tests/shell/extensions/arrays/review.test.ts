import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { BindingStore, IndexedBinding, textToken } from "../../../../src/shell/arrays/bindings.js";
import { ArrayLedger, ArrayOwner } from "../../../../src/shell/arrays/ledger.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

const byteCases = [
  {
    name: "raw array-derived child arg0 remains distinct from replacement text",
    source: `a=($'\\xff' $'\\xfe' '�'); bash -c 'printf "<%s>" "$0" "$@"' "\${a[@]}"`,
    native: `a=($'\\xff' $'\\xfe' '�'); "$BASH" -c 'printf "<%s>" "$0" "$@"' "\${a[@]}"`,
    expected: ["3cff3e3cfe3e3cefbfbd3e", "3cff3e3cfe3e3cefbfbd3e"],
  },
  {
    name: "array element lengths count original bytes in C and invalid bytes in UTF8",
    source: `a=($'\\xe2\\x82' 'é'); printf '<%s>' "\${#a[0]}" "\${#a[1]}"`,
    expected: ["3c323e3c323e", "3c323e3c313e"],
  },
  {
    name: "array star uses the first IFS byte in C and first character in UTF8",
    source: `a=(A B); IFS='é'; printf '<%s>' "\${a[*]}"`,
    expected: ["3c41c3423e", "3c41c3a9423e"],
  },
  {
    name: "array-derived positional star retains a raw IFS separator",
    source: `a=($'\\xff' $'\\xfe'); IFS=$'\\xff'; set -- "\${a[@]}"; printf '<%s>' "$*"`,
    expected: ["3cfffffe3e", "3cfffffe3e"],
  },
  {
    name: "unquoted array splitting recognizes an isolated UTF8 IFS component byte",
    source: `a=($'A\\xa9B'); IFS='é'; printf '<%s>' \${a[@]}`,
    expected: ["3c413e3c423e", "3c413e3c423e"],
  },
  {
    name: "raw IFS cannot split inside a valid UTF8 character outside C",
    source: `a=('AéB'); IFS=$'\\xa9'; printf '<%s>' \${a[@]}`,
    expected: ["3c41c33e3c423e", "3c41c3a9423e"],
  },
] as const;

for (const [profile, locale] of ["C", "en_US.UTF-8"].entries()) {
  for (const entry of byteCases) {
    test(`review: ${locale}: ${entry.name}`, async context => {
      const shell = new Shell({ fs: createMemoryFileSystem() });
      context.after(() => shell.dispose());
      for (const command of basicCommands()) shell.register(command);
      const actual = await shell.exec(entry.source, { env: { LC_ALL: locale } });
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(actual.stderr, "");
      assert.equal(Buffer.from(actual.stdoutBytes).toString("hex"), entry.expected[profile]);
    });
  }
}

test("review: live pinned Bash confirms all byte-boundary expectations", nativeOptions(), () => {
  for (const [profile, locale] of ["C", "en_US.UTF-8"].entries()) {
    for (const entry of byteCases) {
      const native = runNative(`LC_ALL=${locale}; ${"native" in entry ? entry.native : entry.source}`);
      assert.equal(native.status, 0, `${locale}: ${entry.name}`);
      assert.equal(native.stderr.length, 0, `${locale}: ${entry.name}`);
      assert.equal(native.stdout.toString("hex"), entry.expected[profile], `${locale}: ${entry.name}`);
    }
  }
});

for (const command of ["bash /child.sh", "sh /child.sh", "/child.sh"]) {
  test(`review: readonly raw cells survive local restoration and ${command}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/child.sh", Buffer.from('#!/bin/bash\nb=("$@"); printf "<%s>" "${b[@]}"\n'), { mode: 0o755 });
    const shell = new Shell({ fs });
    context.after(() => shell.dispose());
    for (const builtin of basicCommands()) shell.register(builtin);
    const result = await shell.exec(`a=($'\\xff' $'\\xfe' '�'); f() { local -a a=$'\\xfd'; a[2]=$'\\xfc'; printf '<%s>' "\${a[@]}"; }; f; readonly a; ${command} "\${a[@]}"; printf '<%s>' "\${a[@]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3cfd3e3cfc3e3cff3e3cfe3e3cefbfbd3e3cff3e3cfe3e3cefbfbd3e");
  });
}

const readCases = [
  { name: "invalid byte versus replacement separator", input: "ffefbfbd5a0a7461696c", ifs: "efbfbd", raw: true },
  { name: "isolated multibyte IFS component", input: "41a9420a7461696c", ifs: "c3a9", raw: true },
  { name: "raw separator versus valid multibyte payload", input: "41c3a9420a7461696c", ifs: "a9", raw: true },
  { name: "truncated sequence before newline", input: "e2820a7461696c", ifs: "20", raw: true },
  { name: "escaped astral separator with remainder", input: "615cf09f988062f09f988063f09f9880640a7461696c", ifs: "f09f9880", raw: false },
  { name: "escaped NUL preserves native visible prefix", input: "415c00420a7461696c", ifs: "20", raw: false },
] as const;

for (const locale of ["C", "en_US.UTF-8"]) {
  for (const entry of readCases) {
    test(`review: native read chunks ${locale}: ${entry.name}`, nativeOptions(), async () => {
      const bytes = Buffer.from(entry.input, "hex");
      const ifs = Buffer.from(entry.ifs, "hex");
      const inputOctal = [...bytes].map(byte => `\\0${byte.toString(8).padStart(3, "0")}`).join("");
      const ifsOctal = [...ifs].map(byte => `\\0${byte.toString(8).padStart(3, "0")}`).join("");
      const native = runNative(`LC_ALL=${locale}; printf '%b' '${inputOctal}' | { IFS=$(printf '%b' '${ifsOctal}') read ${entry.raw ? "-r" : ""} first second; status=$?; printf '%s\\0' "$status" "$first" "$second"; IFS= read -r -d '' tail; printf '%s' "$tail"; }`);
      assert.equal(native.status, 0);
      assert.equal(native.stderr.length, 0);
      for (const size of [1, 2, 5, 4096]) {
        const controller = new AbortController();
        const budget = new Budget({ ...defaultLimits, maxExpansionBytes: 65536, maxExpansionFields: 4096 }, controller.signal);
        const input = new ShellInput({ async *[Symbol.asyncIterator]() {
          for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
        } }, budget);
        try {
          const line = await input.line(entry.raw, { byteCount: locale === "C" });
          const fields = await line.fields(shellValueFromBytes(ifs), 2);
          const tail: Uint8Array[] = [];
          for await (const chunk of input) tail.push(new Uint8Array(chunk));
          assert.deepEqual(Buffer.concat([
            Buffer.from(line.terminated ? "0\0" : "1\0"),
            shellValueBytes(fields[0]?.value ?? ""), Uint8Array.of(0),
            shellValueBytes(fields[1]?.value ?? ""), Uint8Array.of(0), ...tail,
          ]), native.stdout, `chunk size ${size}`);
          await line.release();
          assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
        } finally { await input.close(); budget.close(); budget.values.close(); }
      }
    });
  }
}

test("review: sibling byte cells survive source subtree retirement without undercharging", async () => {
  const ledger = new ArrayLedger(8192, 256);
  const root = ArrayOwner.create(ledger);
  const sourceOwner = ArrayOwner.create(ledger, root);
  const destinationOwner = ArrayOwner.create(ledger, root);
  try {
    const source = IndexedBinding.create(sourceOwner);
    const destination = IndexedBinding.create(destinationOwner);
    const token = await textToken(source.owner, shellValueFromBytes(Uint8Array.of(255, 254)), new AbortController().signal);
    source.insert(0, token);
    destination.insert(4, token.retain());
    await sourceOwner.close();
    assert.equal(token.references, 1);
    assert.equal(token.admission.released, false);
    assert.equal(ledger.snapshot().used[2], 2);
    const borrowed = shellValueBytes(destination.getValue(4)!);
    borrowed.fill(65);
    assert.deepEqual(shellValueBytes(destination.getValue(4)!), Uint8Array.of(255, 254));
    await destination.release();
    assert.equal(token.admission.released, true);
    assert.equal(ledger.snapshot().used[2], 0);
  } finally { await root.close(); }
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

test("review: abandoned competing preparations retire watches without publishing stale bytes", async () => {
  const ledger = new ArrayLedger(8192, 256);
  const root = ArrayOwner.create(ledger);
  const store = BindingStore.create(root);
  const signal = new AbortController().signal;
  try {
    const first = await store.prepare("cells", signal, false);
    const second = await store.prepare("cells", signal, false);
    try {
      first.binding.insert(0, await textToken(first.binding.owner, shellValueFromBytes(Uint8Array.of(255)), signal));
      second.binding.insert(0, await textToken(second.binding.owner, "�", signal));
      await second.publish();
      await second.close();
      assert.throws(() => first.publish(), /changed/);
      assert.deepEqual(shellValueBytes(store.get("cells")!.getValue(0)!), Uint8Array.of(239, 191, 189));
    } finally { await first.close(); await second.close(); }
    assert.equal(store.watches.size, 0);
  } finally { await root.close(); }
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

for (const reason of [false, 0, "", null]) {
  test(`review: pending field release drains and preserves falsey cancellation ${String(reason)}`, async () => {
    const controller = new AbortController();
    const budget = new Budget({ ...defaultLimits, maxExpansionBytes: 65536, maxExpansionFields: 4096 }, controller.signal);
    const input = new ShellInput({ async *[Symbol.asyncIterator]() { yield Buffer.from(`${"a".repeat(4096)}\n`); } }, budget);
    try {
      const line = await input.line(true);
      const pending = line.fields(" ", 2);
      const rejected = assert.rejects(pending, error => Object.is(error, reason));
      controller.abort(reason);
      const closing = line.release();
      assert.equal(line.release(), closing);
      await rejected;
      await closing;
      assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
      await assert.rejects(line.fields(" "), error => Object.is(error, reason));
    } finally {
      try { await input.close(); } catch (error) { assert.ok(Object.is(error, reason)); }
      budget.close();
      budget.values.close();
    }
  });
}

test("review: input close drains cancelled field work before returning a falsey root reason", async () => {
  const controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxExpansionBytes: 65536, maxExpansionFields: 4096 }, controller.signal);
  const input = new ShellInput({ async *[Symbol.asyncIterator]() { yield Buffer.from(`${"a".repeat(4096)}\ntail`); } }, budget);
  let settled = false;
  let rejected: Promise<void> | undefined;
  try {
    const line = await input.line(true);
    const pending = line.fields(" ", 2);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    rejected = assert.rejects(pending, error => error === false);
    controller.abort(false);
    const closing = input.close();
    assert.equal(input.close(), closing);
    await assert.rejects(closing, error => error === false);
    assert.equal(settled, true);
    assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
  } finally {
    await rejected;
    try { await input.close(); } catch (error) { assert.equal(error, false); }
    budget.close();
    budget.values.close();
  }
});

test("review: closing a borrowed view drains its fields without closing the shared unread bytes", async () => {
  const controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxExpansionBytes: 65536, maxExpansionFields: 4096 }, controller.signal);
  let returned = 0;
  const parent = new ShellInput({ async *[Symbol.asyncIterator]() {
    try { yield Buffer.concat([Buffer.from(`${"a".repeat(4096)}\n`), Uint8Array.of(255, 10)]); }
    finally { returned++; }
  } }, budget);
  const borrowed = new ShellInput(parent, budget);
  let rejected: Promise<void> | undefined;
  try {
    const line = await borrowed.line(true);
    rejected = assert.rejects(line.fields(" ", 2), /Shell input view closed/);
    await borrowed.close();
    assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
    assert.equal(returned, 0);
    assert.equal(controller.signal.aborted, false);
    const tail = await parent.line(true);
    assert.deepEqual(shellValueBytes(tail.shellValue), Uint8Array.of(255));
    await tail.release();
    await parent.close();
    assert.equal(returned, 1);
  } finally {
    await rejected;
    await borrowed.close();
    await parent.close();
    budget.close();
    budget.values.close();
  }
});
