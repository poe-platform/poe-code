import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function bounded<Value>(work: Promise<Value>, label: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: owned drain cycle exceeded observation bound`)), 750);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

const mapfileSource = `value=outer; trap 'printf "exit:%s:<%s>" "$?" "$value"' EXIT; callback() { local value=inner; exit 7; }; mapfile -C callback -c1 values; printf after`;

test("evaluation drain review actual mapfile callback exit completes its own operation drain", { timeout: 2500 }, async () => {
  const rescue = deferred();
  const drains: Promise<void>[] = [];
  let cleanups = 0;
  const extension = mapfileExtension({ replace: true });
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [trapExtension(), {
    ...extension,
    create() {
      const instance = extension.create();
      return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(context: ShellExtensionContext) {
        return builtin.execute(new Proxy(context, { get(target, key, receiver) {
          if (key !== "registerCleanup") return Reflect.get(target, key, receiver);
          return (cleanup: () => void | Promise<void>) => target.registerCleanup(() => {
            cleanups++;
            const drain = Promise.resolve().then(cleanup);
            drains.push(drain);
            return Promise.race([drain, rescue.promise]);
          });
        } }));
      } })) };
    },
  }] });
  for (const command of basicCommands()) shell.register(command);
  const pending = shell.exec(mapfileSource, { stdin: "one\ntwo\n" });
  void pending.catch(() => {});
  try {
    const result = await bounded(pending, "actual mapfile cleanup");
    assert.equal(result.exitCode, 7, result.stderr);
    assert.equal(result.stdout, "exit:7:<inner>");
    assert.equal(result.stderr, "");
    assert.equal(cleanups, 1);
    await bounded(Promise.all(drains), "actual mapfile owned drains");
  } finally {
    rescue.resolve();
    await bounded(pending.catch(() => {}), "mapfile retirement");
    await bounded(Promise.allSettled(drains), "mapfile drain retirement");
    await bounded(shell.dispose(), "mapfile disposal");
  }
});

test("pinned Bash evaluation drain review actual mapfile callback retains local and exit status", {}, () => {
  const result = primaryReference(import.meta.url, mapfileSource, "one\ntwo\n");
  assert.equal(result.status, 7);
  assert.deepEqual(result.stdout, Buffer.from("exit:7:<inner>"));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
});
