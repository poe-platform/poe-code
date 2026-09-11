import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { getCommandArguments } from "../../src/contracts/command.js";
import { setup } from "./helpers.js";

for (const builtin of ["mapfile", "readarray"]) {
  for (const record of [Uint8Array.of(128, 255), Buffer.from("'quoted' $(say WRONG) \\"), new Uint8Array()]) {
    test(`${builtin} callback owns synthetic eval arguments: ${Buffer.from(record).toString("hex")}`, async () => {
      const { shell } = setup({ env: { LC_ALL: "C" } });
      const seen: Uint8Array[][] = [];
      shell.register({ name: "capture", async execute(context) {
        const arguments_ = getCommandArguments(context);
        await setImmediate();
        seen.push(arguments_.values.map((_value, index) => arguments_.bytes(index)!));
        return { exitCode: 0 };
      } });
      try {
        const source = `cb() { capture "$1" "$2"; }; ${builtin} -t -O 7 -C cb -c 1 rows; capture retained "\${rows[7]}"`;
        const result = await shell.exec(source, { stdin: Buffer.concat([record, Uint8Array.of(10)]) });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "");
        assert.deepEqual(seen, [[Uint8Array.of(55), Uint8Array.from(record)], [Uint8Array.from(Buffer.from("retained")), Uint8Array.from(record)]]);
        const next = await shell.exec(`cb() { capture "$1" "$2"; }; ${builtin} -t -C cb -c 1 rows`, { stdin: "next\n" });
        assert.equal(next.exitCode, 0, next.stderr);
        assert.equal(next.stderr, "");
        assert.deepEqual(seen[2], [Uint8Array.of(48), Uint8Array.from(Buffer.from("next"))]);
      } finally { await shell.dispose(); }
    });
  }
}

for (const reason of [false, 0, "", null]) {
  test(`mapfile callback cancellation preserves ${JSON.stringify(reason)} and drains`, async () => {
    const { shell } = setup();
    const caller = new AbortController();
    let callbacks = 0;
    let returned = 0;
    let cleanup = 0;
    shell.register({ name: "cancel", execute(context) {
      callbacks++;
      context.registerCleanup?.(async () => { await setImmediate(); cleanup++; });
      caller.abort(reason);
      context.signal.throwIfAborted();
      return { exitCode: 0 };
    } });
    const stdin = { async *[Symbol.asyncIterator]() {
      try { yield Uint8Array.of(128, 255, 10); yield Uint8Array.of(97, 10); }
      finally { returned++; }
    } };
    try {
      await assert.rejects(shell.exec('mapfile -t -C cancel -c 1 rows', { stdin, signal: caller.signal }), error => Object.is(error, reason));
      assert.equal(callbacks, 1);
      assert.equal(returned, 1);
      assert.equal(cleanup, 1);
    } finally { await shell.dispose(); }
  });
}
