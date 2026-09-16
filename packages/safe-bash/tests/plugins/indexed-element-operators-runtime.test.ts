import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import type { FileSystem } from "poe-code/safe-fs";
import type { Shell, ShellResult } from "poe-code/safe-bash";
import { nextJobReference } from "../shell/extensions/jobs/next53-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { arraysExtension(): Extension; jobsExtension(): Extension };
const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

async function fixture(context: TestContext, profile: "enabled" | "default" | "name-only" | "keys-only" | "readonly-only" = "enabled") {
  const owner: { shell?: Shell } = {};
  context.after(async () => { await owner.shell?.dispose(); });
  const published = await import("poe-code/safe-bash");
  const { createMemoryFileSystem } = await import("poe-code/safe-fs");
  const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
  const fs = createMemoryFileSystem();
  const extensions: Extension[] = profile === "enabled" ? [optional.arraysExtension(), optional.jobsExtension()] : profile === "default" ? [] : [{
    name: "arrays", runtimeIdentity: published.commandRuntimeIdentity,
    ...(profile === "keys-only" ? { syntax: { arrayKeys: true as const } } : profile === "readonly-only" ? { syntax: { indexedDeclarations: ["readonly"] as const } } : {}),
    create: () => ({ builtins: [] }),
  }];
  owner.shell = new published.Shell({ fs, extensions }).use(published.agentCommands());
  return { shell: owner.shell, fs, published, optional };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe("compiled opt-in literal indexed element operators", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["inline", "bash", "sh"] as const) {
    test(`public ${route} retains exact wait23 indexed guest source`, async context => {
      const reference = nextJobReference(23);
      assert.equal(reference.provenance.sourceSHA256, "b18e1b23b1e20fedb6110d9b7087191e2f0162bd8214596d5a99ba392d1df1df");
      assert.equal(reference.request.gates.length, 0);
      const { shell, fs } = await fixture(context);
      if (route !== "inline") await fs.writeFile("/indexed.sh", Buffer.from(reference.source));
      const result = await shell.exec(route === "inline" ? reference.source : `${route} /indexed.sh`, { stdin: reference.stdin, env: reference.request.environment });
      assert.equal(result.exitCode, reference.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
      assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
    });

    test(`public ${route} retains wait17 indexed language with qualified owned VFS envelope`, { timeout: 2500 }, async context => {
      const reference = nextJobReference(17);
      assert.equal(reference.provenance.sourceSHA256, "d745ef2184dd34f9b5bcad735b7a6fddc771f3101ed6949a6b64884c1a3db465");
      assert.deepEqual(reference.request.gates, [{ fd: 3, after: "WAIT_READY", bytesHex: "72656c656173650a" }]);
      const gate = deferred();
      const controller = new AbortController();
      const owner: { shell?: Shell; running?: Promise<ShellResult>; timer?: ReturnType<typeof setTimeout> } = {};
      context.after(async () => {
        clearTimeout(owner.timer);
        controller.abort(new Error("public indexed wait fixture cleanup"));
        gate.resolve();
        await owner.running?.catch(() => undefined);
        await owner.shell?.dispose();
      });
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
      const memory = createMemoryFileSystem();
      await memory.writeFile("/gate3", Buffer.from(reference.request.gates[0]!.bytesHex, "hex"));
      await memory.writeFile("/control", new Uint8Array());
      const resources: { path: string; closes: number }[] = [];
      let control = "";
      let released = false;
      const fs: FileSystem = new Proxy(memory, { get(target, property) {
        if (property === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
          const descriptor = await target.open!(...args);
          const resource = { path: args[0], closes: 0 };
          resources.push(resource);
          return new Proxy(descriptor, { get(retained, member) {
            if (member === "close") return async () => { resource.closes++; await retained.close(); };
            if (member === "read" && args[0] === "/gate3") return async (...operation: Parameters<typeof descriptor.read>) => {
              await gate.promise;
              operation[2]?.signal?.throwIfAborted();
              return retained.read(...operation);
            };
            if (member === "write" && args[0] === "/control") return async (...operation: Parameters<typeof descriptor.write>) => {
              const count = await retained.write(...operation);
              control += Buffer.from(operation[0].subarray(0, count)).toString();
              if (control.includes("WAIT_READY\n")) { released = true; gate.resolve(); }
              return count;
            };
            const value: unknown = Reflect.get(retained, member, retained);
            return typeof value === "function" ? value.bind(retained) : value;
          } });
        };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      owner.shell = new published.Shell({ fs, extensions: [optional.arraysExtension(), optional.jobsExtension()], env: reference.request.environment }).use(published.agentCommands());
      const source = `{ ${reference.source}; } 3</gate3 7>/control`;
      if (route !== "inline") await memory.writeFile("/indexed.sh", Buffer.from(source));
      owner.timer = setTimeout(() => { controller.abort(new Error("public indexed wait fixture deadline")); gate.resolve(); }, 1500);
      owner.running = owner.shell.exec(route === "inline" ? source : `${route} /indexed.sh`, { stdin: reference.stdin, signal: controller.signal });
      const result = await owner.running;
      clearTimeout(owner.timer);
      assert.equal(result.exitCode, reference.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
      assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
      assert.equal(released, true);
      assert.equal(resources.filter(resource => resource.path === "/gate3").length, 1);
      assert.equal(resources.filter(resource => resource.path === "/control").length, 1);
      assert.ok(resources.every(resource => resource.closes === 1));
    });

    for (const [setup, expected] of [["values=(left right)", "right:x"], ["values=(left '')", ":x"], ["values=(left)", "fallback:"]] as const) {
      test(`public ${route} distinguishes literal element presence: ${setup}`, async context => {
        const { shell, fs } = await fixture(context);
        const source = `${setup}; printf '%s:%s' "\${values[1]-fallback}" "\${values[1]+x}"`;
        if (route !== "inline") await fs.writeFile("/indexed.sh", Buffer.from(source));
        const result = await shell.exec(route === "inline" ? source : `${route} /indexed.sh`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
      });
    }
  }

  for (const profile of ["default", "name-only", "keys-only", "readonly-only"] as const) for (const operator of ["-", "+"] as const) {
    test(`public ${profile} does not admit indexed ${operator}`, async context => {
      const { shell } = await fixture(context, profile);
      const result = await shell.exec(`values=(set); printf '%s' "\${values[0]${operator}unexpected}"`);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /Unsupported indexed-array operator/u);
    });
  }

  test("public indexed selected bytes and lazy substitution status remain distinct", async context => {
    const { shell } = await fixture(context);
    const result = await shell.exec("values=($'\\xff'); printf '%s%s' \"${values[0]-$(exit 9)}\" \"${values[1]+$(exit 9)}\"; selected=${values[1]-$(printf '\\376'; exit 7)}; status=$?; printf '%s:%s' \"$selected\" \"$status\"");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual([...result.stdoutBytes], [255, 254, 58, 55]);
  });

  test("public indexed factory preserves affinity without exporting or registering defaults", async context => {
    const { published, optional } = await fixture(context);
    const definition = optional.arraysExtension();
    assert.equal(definition.runtimeIdentity, published.commandRuntimeIdentity);
    assert.deepEqual(definition.create().builtins, []);
    assert.equal(Object.hasOwn(published, "arraysExtension"), false);
    assert.equal(Object.hasOwn(published, "jobsExtension"), false);
  });
});
