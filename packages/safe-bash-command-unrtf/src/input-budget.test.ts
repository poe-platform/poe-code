import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts";
import { createUnrtfCommand } from "./index.js";

const bytes = new TextEncoder().encode("{\\rtf1 hello world}");
for (const factory of [createUnrtfCommand]) {
  for (const mode of ["stdin", "stream", "file"] as const) {
    for (const maximum of [0, bytes.length - 1, bytes.length, Infinity]) {
      test(`${factory.name} checks ${mode} input against ${maximum} bytes`, async () => {
        const memory = createMemoryFileSystem();
        await memory.writeFile("/input", bytes);
        const fs = new Proxy(memory, { get(target, key) {
          if (mode === "file" && key === "readStream") return undefined;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
        const failure = Object.assign(new Error("input budget exceeded"), { name: "BudgetExceededError" });
        const totals: number[] = [];
        const context: CommandContext = {
          command: "unrtf", args: createCommandArguments([...["--text"], ...(mode === "stdin" ? [] : ["/input"])]).args,
          cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () { yield bytes.subarray(0, 2); yield bytes.subarray(2); })(),
          stdout: { async write() {} }, stderr: { async write() {} },
          inputBudget: { maxBytes: maximum, check(total) { totals.push(total); if (total > maximum) throw failure; } },
        };
        if (maximum < bytes.length) await assert.rejects(async () => factory().execute(context), error => error === failure);
        else {
          assert.equal((await factory().execute(context)).exitCode, 0);
          assert.equal(totals.at(-1), bytes.length);
        }
      });
    }
    for (const name of ["BudgetExceededError", "AbortError"]) {
      test(`${factory.name} propagates ${name} from ${mode}`, async () => {
        const failure = Object.assign(new Error(name), { name });
        const fs = createMemoryFileSystem();
        Object.defineProperty(fs, "readStream", { value: mode === "file" ? undefined : () => ({ async *[Symbol.asyncIterator]() { yield await Promise.reject<Uint8Array>(failure); } }) });
        Object.defineProperty(fs, "openReadFile", { value: async () => { throw failure; } });
        const context: CommandContext = {
          command: "unrtf", args: createCommandArguments([...["--text"], ...(mode === "stdin" ? [] : ["/input"])]).args,
          cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield await Promise.reject<Uint8Array>(failure); } },
          stdout: { async write() {} }, stderr: { async write() {} },
        };
        await assert.rejects(async () => factory().execute(context), error => error === failure);
      });
    }
  }
}
