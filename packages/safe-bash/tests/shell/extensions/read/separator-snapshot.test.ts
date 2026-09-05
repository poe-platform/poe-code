import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes, type ShellValue } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function subject(rewrite: (context: ShellExtensionContext) => ShellExtensionContext) {
  const definition = readExtension();
  const shell = new Shell({
    fs: createMemoryFileSystem(),
    extensions: [arraysExtension(), { ...definition, create() {
      const instance = definition.create();
      return { ...instance, builtins: instance.builtins.map(builtin => ({
        ...builtin, execute: invocation => builtin.execute(rewrite(invocation)),
      })) };
    } }],
    limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 },
  });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const kind of ["scalar", "array"] as const) {
  for (const binary of [false, true]) test(`source-backed separator snapshot: pending ${kind} read retains ${binary ? "raw" : "text"} IFS`, async context => {
    const events: string[] = [];
    const pulling = deferred();
    const available = deferred();
    let snapshot: ShellValue | undefined;
    let retainedAtClose: Uint8Array | undefined;
    const shell = subject(invocation => ({ ...invocation,
      bindings: { ...invocation.bindings, get(name, index) {
        const value = invocation.bindings.get(name, index);
        if (name === "IFS") { events.push("get"); snapshot = value; }
        return value;
      } },
      input: { ...invocation.input, borrow(descriptor) {
        events.push("borrow");
        const borrowed = invocation.input.borrow(descriptor);
        return { ...borrowed,
          async read(raw, options) {
            events.push("read");
            const pending = borrowed.read(raw, options);
            void pending.catch(() => undefined);
            await pulling.promise;
            await invocation.bindings.assign("IFS", ",");
            events.push("mutate");
            available.resolve();
            return pending;
          },
          async release() {
            events.push("release");
            retainedAtClose = snapshot === undefined ? undefined : shellValueBytes(snapshot);
            await borrowed.release();
          },
        };
      } },
    }));
    context.after(async () => { available.resolve(); await shell.dispose(); });
    const source = `${binary ? "IFS=$'\\xff'" : "IFS=:"}; read -r ${kind === "array" ? "-a values" : "first last"}; printf '<%s>' ${kind === "array" ? '"${values[@]}"' : '"$first" "$last"'}`;
    const result = await shell.exec(source, { stdin: { async *[Symbol.asyncIterator]() {
      pulling.resolve();
      await available.promise;
      yield binary ? Uint8Array.of(65, 255, 66, 254, 67, 10) : new TextEncoder().encode("a:b,c\n");
    } } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, binary ? Uint8Array.of(60, 65, 62, 60, 66, 254, 67, 62) : new TextEncoder().encode("<a><b,c>"));
    assert.deepEqual(events, ["get", "borrow", "read", "mutate", "release"]);
    assert.deepEqual(retainedAtClose, binary ? Uint8Array.of(255) : Uint8Array.of(58));
  });
}

for (const initial of ["unset IFS", "IFS="]) test(`source-backed separator snapshot: ${initial} remains distinct during pending input`, async context => {
  const events: string[] = [];
  const shell = subject(invocation => ({ ...invocation,
    bindings: { ...invocation.bindings, get(name, index) {
      if (name === "IFS") events.push("get");
      return invocation.bindings.get(name, index);
    } },
    input: { ...invocation.input, borrow(descriptor) {
      events.push("borrow");
      const borrowed = invocation.input.borrow(descriptor);
      return { ...borrowed, async read(raw, options) {
        events.push("read");
        const pending = borrowed.read(raw, options);
        await invocation.bindings.assign("IFS", ",");
        return pending;
      } };
    } },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec(`${initial}; read -r first last; printf '<%s><%s>' "$first" "$last"`, { stdin: "a b,c\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, initial === "unset IFS" ? "<a><b,c>" : "<a b,c><>");
  assert.deepEqual(events, ["get", "borrow", "read"]);
});

for (const target of ["first last", "-a values"]) test(`separator mutation leaves subsequent input records intact: ${target}`, async context => {
  let invocations = 0;
  let releases = 0;
  const shell = subject(invocation => {
    if (++invocations !== 1) return invocation;
    return { ...invocation, input: { ...invocation.input, borrow(descriptor) {
      const borrowed = invocation.input.borrow(descriptor);
      return { ...borrowed,
        async read(raw, options) {
          const pending = borrowed.read(raw, options);
          await invocation.bindings.assign("IFS", ",");
          return pending;
        },
        async release() { releases++; await borrowed.release(); },
      };
    } } };
  });
  context.after(() => shell.dispose());
  const source = `IFS=$'\\xff'; read -r ${target}; printf '<%s>' ${target === "first last" ? '"$first" "$last"' : '"${values[@]}"'}; IFS= read -r tail; printf '|%s:<%s>' "$?" "$tail"; IFS= read -r tail; printf '|%s' "$?"`;
  const result = await shell.exec(source, { stdin: Uint8Array.of(65, 255, 66, 254, 67, 10, ...new TextEncoder().encode("TAIL:still,whole\n")) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(60, 65, 62, 60, 66, 254, 67, 62, ...new TextEncoder().encode("|0:<TAIL:still,whole>|1")));
  assert.equal(invocations, 3);
  assert.equal(releases, 1);
});

for (const target of ["first", "-a values"]) test(`exact -N does not acquire IFS: ${target}`, async context => {
  const shell = subject(invocation => ({ ...invocation,
    bindings: { ...invocation.bindings, get(name, index) {
      assert.notEqual(name, "IFS", "Exact input must not retain IFS");
      return invocation.bindings.get(name, index);
    } },
    input: { ...invocation.input, borrow(descriptor) {
      const borrowed = invocation.input.borrow(descriptor);
      return { ...borrowed, async read(raw, options) {
        assert.equal(options?.exact, true);
        await invocation.bindings.assign("IFS", ",");
        return borrowed.read(raw, options);
      } };
    } },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec(`IFS=:; read -N3 ${target}; printf '<%s>' ${target === "first" ? '"$first"' : '"${values[@]}"'}`, { stdin: "a:b\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "<a:b>");
  assert.equal(result.stderr, "");
});

for (const target of ["value", "-a values"]) test(`zero timeout bypasses separator lookup and borrow: ${target}`, async context => {
  let probes = 0;
  const shell = subject(invocation => ({ ...invocation,
    bindings: { ...invocation.bindings, get(name, index) {
      assert.notEqual(name, "IFS", "Readiness must not retain separators");
      return invocation.bindings.get(name, index);
    } },
    input: { ...invocation.input,
      borrow() { throw new Error("Readiness must not borrow input"); },
      observe(descriptor) {
        const observer = invocation.input.observe(descriptor);
        return { ...observer, async probeRead() { probes++; return observer.probeRead(); } };
      },
    },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec(`IFS=:; value=OLD; values=(KEEP STAY); readonly value values; read -t0 ${target}; printf '%s:<%s>' "$?" "$value"`, { stdin: "untouched\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0:<OLD>");
  assert.equal(result.stderr, "");
  assert.equal(probes, 1);
});

for (const target of ["value", "-a values"]) test(`source-backed separator snapshot precedes instrumented observer wait: ${target}`, async context => {
  const events: string[] = [];
  let snapshot: ShellValue | undefined;
  let retainedAtClose: Uint8Array | undefined;
  const shell = subject(invocation => ({ ...invocation,
    bindings: { ...invocation.bindings, get(name, index) {
      const value = invocation.bindings.get(name, index);
      if (name === "IFS") { events.push("get"); snapshot = value; }
      return value;
    } },
    input: { ...invocation.input,
      borrow(descriptor) { events.push("borrow"); return invocation.input.borrow(descriptor); },
      observe(descriptor) {
        events.push("observe");
        const observer = invocation.input.observe(descriptor);
        assert.equal(observer.readable, false);
        return { ...observer,
          async probeRead() { events.push("probe"); return { readiness: "blocked" as const, timeout: "honor" as const }; },
          async waitRead(options) {
            assert.equal(options.timeoutMs, 1000);
            assert.equal(options.signal, invocation.signal);
            events.push("wait");
            await invocation.bindings.assign("IFS", ",");
            events.push("mutate");
            return "timeout" as const;
          },
          async release() {
            events.push("release");
            retainedAtClose = snapshot === undefined ? undefined : shellValueBytes(snapshot);
            await observer.release();
          },
        };
      },
    },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec(`IFS=$'\\xff'; value=OLD; values=(KEEP STAY); read -t1 -u3 ${target} 3>/out; printf '%s:' "$?"; printf '<%s>' ${target === "value" ? '"$value"' : '"${values[@]}"'}`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "142:<>");
  assert.equal(result.stderr, "");
  assert.deepEqual(events, ["get", "borrow", "observe", "probe", "wait", "mutate", "release"]);
  assert.deepEqual(retainedAtClose, Uint8Array.of(255));
});

for (const route of ["read", "wait"] as const) for (const reason of [false, 0, null]) {
  test(`raw separator lifetime drains ${route} cleanup and preserves cancellation ${String(reason)}`, async context => {
    const controller = new AbortController();
    const pending = deferred();
    const mutated = deferred();
    const closing = deferred();
    const release = deferred();
    let snapshot: ShellValue | undefined;
    let retainedAtClose: Uint8Array | undefined;
    let releases = 0;
    let assignments = 0;
    const shell = subject(invocation => {
      const mutate = async () => {
        await invocation.bindings.assign("IFS", ",");
        mutated.resolve();
        await pending.promise;
        invocation.signal.throwIfAborted();
        throw new Error("Test requires cancellation");
      };
      const drain = async (finish: () => Promise<void>) => {
        releases++;
        retainedAtClose = snapshot === undefined ? undefined : shellValueBytes(snapshot);
        closing.resolve();
        await release.promise;
        await finish();
        throw new Error("secondary cleanup failure");
      };
      return { ...invocation,
        bindings: { ...invocation.bindings,
          get(name, index) {
            const value = invocation.bindings.get(name, index);
            if (name === "IFS") snapshot = value;
            return value;
          },
          async assign(name, value) { assignments++; await invocation.bindings.assign(name, value); },
        },
        input: { ...invocation.input,
          borrow(descriptor) {
            const borrowed = invocation.input.borrow(descriptor);
            assert.equal(route, "read");
            return { ...borrowed, read: mutate, release: () => drain(() => borrowed.release()) };
          },
          observe(descriptor) {
            assert.equal(route, "wait");
            const observer = invocation.input.observe(descriptor);
            return { ...observer,
              async probeRead() { return { readiness: "blocked" as const, timeout: "honor" as const }; },
              waitRead: mutate,
              release: () => drain(() => observer.release()),
            };
          },
        },
      };
    });
    context.after(async () => { pending.resolve(); release.resolve(); await shell.dispose(); });
    let settled = false;
    const execution = shell.exec(`IFS=$'\\xff'; read ${route === "wait" ? "-t1 -u3 value 3>/out" : "value"}`, { stdin: "a\n", signal: controller.signal });
    const outcome = execution.then(value => ({ value, failed: false as const }), error => ({ error, failed: true as const })).finally(() => { settled = true; });
    await mutated.promise;
    controller.abort(reason);
    pending.resolve();
    await closing.promise;
    await Promise.resolve();
    assert.equal(settled, false);
    release.resolve();
    const result = await outcome;
    assert.equal(result.failed, true);
    if (result.failed) assert.equal(result.error, reason);
    assert.equal(releases, 1);
    assert.equal(assignments, 0);
    assert.deepEqual(retainedAtClose, Uint8Array.of(255));
  });
}
