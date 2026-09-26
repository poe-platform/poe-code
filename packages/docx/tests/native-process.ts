import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { afterAll, afterEach, beforeAll } from "vitest";

// Load the normal Node runtime once, while each request creates its own document,
// filesystem and budget. A failed request must not leave a child doing work.
export function useNativeProcess(args: string[], source?: string) {
  let child: ChildProcessWithoutNullStreams;
  let replies: AsyncIterator<string>;
  let completed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  let stderr = "";
  let pending = false;

  beforeAll(async () => {
    child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    completed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", error => { stderr += String(error); });
    child.stdin.on("error", error => { stderr += String(error); });
    replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    if (source !== undefined) await new Promise<void>((resolve, reject) => {
      child.stdin.write(JSON.stringify(source) + "\n", error => error ? reject(error) : resolve());
    });
    const ready = await replies.next();
    assert.equal(ready.done, false, stderr);
    assert.deepEqual(JSON.parse(ready.value), { ready: true });
  });

  afterEach(() => {
    if (pending) child.kill();
  });

  afterAll(async () => {
    child.stdin.end();
    assert.deepEqual(await completed, { code: 0, signal: null }, stderr);
  });

  return async (request: unknown): Promise<unknown> => {
    assert.equal(pending, false, "Native requests must be sequential");
    pending = true;
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(JSON.stringify(request) + "\n", error => error ? reject(error) : resolve());
    });
    const reply = await replies.next();
    pending = false;
    assert.equal(reply.done, false, stderr);
    return JSON.parse(reply.value);
  };
}
