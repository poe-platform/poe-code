import assert from "node:assert/strict";
import type { ByteSource } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

const scenario = process.argv[2];
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const keepAlive = setInterval(() => {}, 1000);

if (scenario === "cleanup-abort" || scenario === "cleanup-late-rejection") {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = new Error("cancel during input cleanup");
  let returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() {
    return {
      next() { throw new Error("cleanup probe must not read"); },
      return() {
        returns++;
        setTimeout(() => controller.abort(reason), 20);
        return new Promise((_resolve, reject) => {
          if (scenario === "cleanup-late-rejection") setTimeout(() => reject(new Error("late cleanup rejection")), 40);
        });
      },
    };
  } };
  await assert.rejects(shell.exec("true", { stdin, signal: controller.signal }), (error) => error === reason);
  assert.equal(returns, 1);
  await delay(60);
} else if (scenario === "shared-delayed-generator") {
  const { shell } = setup();
  const stdin = (async function* () { await delay(40); yield new Uint8Array([65]); yield new Uint8Array([66]); })();
  assert.equal((await shell.exec("pass | true; pass", { stdin })).stdout, "B");
} else if (scenario === "shared-abandoned-rejection" || scenario === "shared-retained-rejection") {
  const { shell } = setup();
  let reads = 0;
  let returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; await delay(40); throw new Error("delayed source error"); },
    async return() { returns++; return { value: undefined, done: true }; },
  }; } };
  const retained = scenario === "shared-retained-rejection";
  const result = await shell.exec(retained ? "pass | true; pass" : "pass | true", { stdin });
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /delayed source error/u);
  assert.equal(reads, 1);
  assert.equal(returns, 1);
  await delay(60);
} else if (scenario === "shared-serialized" || scenario === "shared-repeated-cancellation") {
  const { shell } = setup();
  let active = 0;
  let maximum = 0;
  let position = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() {
    return {
      async next() {
        active++;
        maximum = Math.max(maximum, active);
        const index = position++;
        try {
          await delay(index === 0 ? 40 : 5);
          return index < 2 ? { value: new Uint8Array([65 + index]), done: false } : { value: undefined, done: true };
        } finally { active--; }
      },
      async return() { return { value: undefined, done: true }; },
    };
  } };
  const script = scenario === "shared-repeated-cancellation" ? "pass | true; pass | true; pass" : "pass | true; pass";
  assert.equal((await shell.exec(script, { stdin })).stdout, scenario === "shared-repeated-cancellation" ? "" : "B");
  assert.equal(maximum, 1);
  assert.equal(position, 3);
} else if (scenario === "busy-loop-abort") {
  const { shell, fs } = setup();
  const controller = new AbortController();
  const reason = new Error("cancel busy loop");
  const timer = setTimeout(() => controller.abort(reason), 20);
  try {
    await assert.rejects(shell.exec("while true; do :; done; : >after", {
      signal: controller.signal,
      limits: { maxCommands: 1_000_000_000, maxLoopIterations: 1_000_000_000 },
    }), (error) => error === reason);
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { clearTimeout(timer); }
} else if (scenario === "owned-cleanup-abort") {
  const { shell, fs } = setup();
  await fs.writeFile("/input", new Uint8Array([65]));
  const controller = new AbortController();
  const reason = new Error("cancel owned input cleanup");
  let returns = 0;
  fs.readStream = () => ({ [Symbol.asyncIterator]() { return {
    async next() { return { value: new Uint8Array([65]), done: false }; },
    return() { returns++; setTimeout(() => controller.abort(reason), 20); return new Promise(() => {}); },
  }; } });
  await assert.rejects(shell.exec("true <input", { signal: controller.signal }), (error) => error === reason);
  assert.equal(returns, 1);
} else throw new Error(`Unknown lifecycle probe: ${scenario}`);

clearInterval(keepAlive);
console.log(`${scenario}: passed`);
