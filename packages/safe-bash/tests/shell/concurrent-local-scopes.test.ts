import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem, Shell, standardCommands } from "../../src/index.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function gate() {
  return { entered: deferred(), released: deferred() };
}

for (const scope of ["root", "subshell"] as const) {
  test(`concurrent ${scope} states keep function locals and positionals independent`, { timeout: 5000 }, async context => {
    const firstEntered = gate();
    const secondEntered = gate();
    const firstLocalized = gate();
    const gates = new Map([
      ["first-entered", firstEntered],
      ["second-entered", secondEntered],
      ["first-localized", firstLocalized],
    ]);
    const shells = ["first", "second"].map(() => {
      const shell = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands());
      shell.commands.register({
        name: "pause",
        async execute({ args, signal }) {
          const selected = gates.get(args[0]!);
          assert.ok(selected);
          signal.throwIfAborted();
          selected.entered.resolve();
          const aborted = deferred();
          const onAbort = () => aborted.reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          try { await Promise.race([selected.released.promise, aborted.promise]); }
          finally { signal.removeEventListener("abort", onAbort); }
          signal.throwIfAborted();
          return { exitCode: 0 };
        },
      });
      return shell;
    });
    const pending: ReturnType<Shell["exec"]>[] = [];
    const source = (name: "first" | "second") => {
      const program = `
        value=${name}-outer
        set -- ${name}-outer-position ${name}-tail
        array=(one two)
        f() {
          pause ${name}-entered
          local value=${name}-local
          set -- ${name}-local-position
          ${name === "first" ? "pause first-localized" : ":"}
          printf 'inside:%s:%s:%s\\n' "$value" "$1" "$#"
        }
        f ${name}-function-position
        printf 'after:%s:%s:%s\\n' "$value" "$1" "$#"
      `;
      return scope === "root" ? program : `(${program})\nprintf 'root:%s:%s\\n' "\${value-unset}" "$#"`;
    };
    const expected = (name: "first" | "second") =>
      `inside:${name}-local:${name}-local-position:1\nafter:${name}-outer:${name}-outer-position:2\n${scope === "subshell" ? "root:unset:0\n" : ""}`;
    const waitForEntry = async (selected: ReturnType<typeof gate>, operation: ReturnType<Shell["exec"]>) => {
      await Promise.race([
        selected.entered.promise,
        operation.then(result => { assert.fail(`Shell completed before the expected gate: ${JSON.stringify(result)}`); }),
      ]);
    };
    try {
      const first = shells[0]!.exec(source("first"), { signal: context.signal });
      pending.push(first);
      await waitForEntry(firstEntered, first);
      const second = shells[1]!.exec(source("second"), { signal: context.signal });
      pending.push(second);
      await waitForEntry(secondEntered, second);

      // Both frames are live before the first shell declares its local value.
      firstEntered.released.resolve();
      await waitForEntry(firstLocalized, first);
      secondEntered.released.resolve();
      const secondResult = await second;
      assert.equal(secondResult.exitCode, 0, secondResult.stderr);
      assert.equal(secondResult.stderr, "");
      assert.equal(secondResult.stdout, expected("second"));

      firstLocalized.released.resolve();
      const firstResult = await first;
      assert.equal(firstResult.exitCode, 0, firstResult.stderr);
      assert.equal(firstResult.stderr, "");
      assert.equal(firstResult.stdout, expected("first"));
    } finally {
      for (const selected of gates.values()) selected.released.resolve();
      await Promise.allSettled(pending);
      await Promise.all(shells.map(shell => shell.dispose()));
    }
  });
}
