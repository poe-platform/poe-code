import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setImmediate as turn } from "node:timers/promises";
import { FsError } from "../../../src/contracts/errors.js";
import { WebDavFileSystem, type WebDavFetch } from "../../../src/fs/webdav/index.js";
import { MockDav } from "../../fs/webdav/mock.js";

const baseUrl = "http://independent.invalid/dav/";
const destination = "/target ü";
const destinationUrl = `${baseUrl}target%20%C3%BC/`;
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function bounded<Value>(pending: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("independent 1200ms settlement bound exceeded")), 1200);
    })]);
  } finally { clearTimeout(timer); }
}

function observed<Value>(pending: Promise<Value>) {
  return pending.then(value => ({ kind: "value" as const, value }), error => ({ kind: "error" as const, error: error as unknown }));
}

async function failure(pending: ReturnType<typeof observed>, code: "ECANCELED" | "ETIMEDOUT", signal: AbortSignal): Promise<void> {
  const result = await bounded(pending);
  assert.equal(result.kind, "error");
  if (result.kind !== "error") throw new Error("expected adapter rejection");
  assert.ok(result.error instanceof FsError);
  assert.equal(result.error.code, code);
  assert.equal(signal.aborted, true);
  assert.equal(result.error.cause, signal.reason);
}

interface Operation {
  method: string;
  url: string;
  signal: AbortSignal;
  afterCancellation: boolean;
  token: string | null;
}

class Lab {
  readonly controller = new AbortController();
  readonly mock = new MockDav();
  readonly operations: Operation[] = [];
  readonly events: string[] = [];
  readonly disposals: Promise<unknown>[] = [];
  readonly cleanups: (() => Promise<unknown>)[] = [];
  cancellationObserved = false;

  constructor() {
    this.mock.files.set("/source", null);
    this.mock.files.set("/source/child", bytes("preserve"));
    this.mock.files.set(destination, null);
    this.mock.files.set("/input", bytes("input unchanged"));
  }

  adapter(intercept: WebDavFetch, timeoutMs = 5000): WebDavFileSystem {
    return new WebDavFileSystem({ baseUrl, timeoutMs, fetch: (url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false, "no operation starts with an aborted signal");
      assert.equal(init.redirect, "manual");
      assert.equal(init.credentials, "omit");
      const method = init.method!;
      this.operations.push({ method, url, signal: init.signal,
        afterCancellation: this.cancellationObserved || this.controller.signal.aborted,
        token: new Headers(init.headers).get("Lock-Token") });
      this.events.push(`request:${method}:${url}`);
      return intercept(url, init);
    } });
  }

  abort(): void {
    this.cancellationObserved = true;
    this.events.push("caller.abort");
    this.controller.abort(new Error("independent caller abort"));
  }

  markSettled(code: string): void {
    this.cancellationObserved = true;
    this.events.push(`outward.settled:${code}:host-still-pending`);
  }

  assertPolicy(allowedUnlocks = 0): void {
    const late = this.operations.filter(operation => operation.afterCancellation);
    assert.equal(late.length, allowedUnlocks, "only explicitly authorized cleanup may start after cancellation");
    for (const operation of late) {
      assert.equal(operation.method, "UNLOCK");
      assert.equal(operation.url, destinationUrl);
      assert.notEqual(operation.signal, this.controller.signal);
    }
  }

  dispose(response: Response): void {
    if (response.body && !response.body.locked) this.disposals.push(response.body.cancel().catch(() => {}));
  }
}

function check(name: string, run: (lab: Lab, context: TestContext) => Promise<void>): void {
  test(name, { timeout: 8000 }, async context => {
    const lab = new Lab();
    const started = performance.now();
    const failures: unknown[] = [];
    try { await run(lab, context); }
    catch (error) {
      failures.push(error);
      lab.events.push(`failure:${String(error)}`);
      console.error(`VERIFIER_ASSERTION ${name}: ${String(error)}`);
    }
    finally {
      lab.controller.abort();
      for (const cleanup of lab.cleanups.reverse()) {
        try { await bounded(cleanup()); }
        catch (error) { failures.push(error); lab.events.push(`cleanup.failure:${String(error)}`); }
      }
      await Promise.all(lab.disposals);
      lab.events.push(`fixture.remaining-locks:${lab.mock.locks.size}`);
      lab.mock.locks.clear();
      await turn();
      await turn();
      console.log(JSON.stringify({ name, verdict: failures.length ? "FAIL" : "PASS", durationMs: performance.now() - started,
        events: lab.events, operations: lab.operations.map(({ signal, ...operation }) => ({ ...operation, signalAbortedAtEnd: signal.aborted })) }));
    }
    if (failures.length) throw new AggregateError(failures, "independent verification failure");
  });
}

check("V01 caller abort settles ignored metadata and observes unguarded late rejection", async lab => {
  const entered = deferred<AbortSignal>();
  const host = deferred<Response>();
  const fs = lab.adapter((_url, init) => { entered.resolve(init.signal!); return host.promise; });
  const operation = observed(fs.stat("/input", { signal: lab.controller.signal }));
  lab.cleanups.push(async () => { host.reject(new Error("late metadata host rejection")); await operation; });
  const signal = await bounded(entered.promise);
  lab.abort();
  await failure(operation, "ECANCELED", signal);
  lab.markSettled("ECANCELED");
  await assert.rejects(fs.stat("/input", { signal: lab.controller.signal }), (error: unknown) => error instanceof FsError && error.code === "ECANCELED");
  host.reject(new Error("late metadata host rejection"));
  await turn();
  lab.events.push("unguarded-host-promise:late-rejection-observed-by-adapter");
  assert.equal(lab.operations.length, 1);
  lab.assertPolicy();
});

check("V02 deadline settles ignored accepted PUT without rolling back published bytes", async lab => {
  const accepted = deferred<AbortSignal>();
  const host = deferred<Response>();
  let hostEntered = false;
  const fs = lab.adapter(async (url, init) => {
    if (init.method === "PROPFIND") return lab.mock.fetch(url, init);
    assert.equal(init.method, "PUT");
    const response = await lab.mock.fetch(url, init);
    assert.equal(response.status, 201);
    lab.dispose(response);
    hostEntered = true;
    accepted.resolve(init.signal!);
    return host.promise;
  }, 60);
  const operation = observed(fs.writeFile("/published", bytes("accepted before deadline")));
  lab.cleanups.push(async () => {
    if (hostEntered) host.reject(new Error("late accepted PUT rejection"));
    else host.resolve(new Response(null));
    await operation;
  });
  const signal = await bounded(accepted.promise);
  await failure(operation, "ETIMEDOUT", signal);
  lab.markSettled("ETIMEDOUT");
  assert.equal(lab.controller.signal.aborted, false);
  assert.deepEqual(lab.mock.files.get("/published"), bytes("accepted before deadline"));
  host.reject(new Error("late accepted PUT rejection"));
  await turn();
  lab.events.push("published-bytes:retained:outward-timeout-is-not-rollback");
  assert.deepEqual(lab.operations.map(operation => operation.method), ["PROPFIND", "PUT"]);
  lab.assertPolicy();
});

check("V03 late GET cancels unlocked body without waiting for rejecting host cleanup", async lab => {
  const entered = deferred<AbortSignal>();
  const host = deferred<Response>();
  const canceled = deferred<unknown>();
  const cleanup = deferred<void>();
  let pulls = 0;
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    pull() { pulls++; },
    cancel(reason) { cancellations++; canceled.resolve(reason); return cleanup.promise; },
  }, { highWaterMark: 0 });
  const fs = lab.adapter((url, init) => {
    if (init.method === "PROPFIND") return lab.mock.fetch(url, init);
    assert.equal(init.method, "GET");
    entered.resolve(init.signal!);
    return host.promise;
  });
  const stream = fs.readStream("/input", { signal: lab.controller.signal });
  const operation = observed(stream.next());
  const response = new Response(body);
  lab.cleanups.push(async () => {
    host.resolve(response);
    if (cancellations) cleanup.reject(new Error("late body cleanup rejection"));
    else cleanup.resolve();
    await operation;
    await stream.return(undefined);
    lab.dispose(response);
  });
  const signal = await bounded(entered.promise);
  lab.abort();
  await failure(operation, "ECANCELED", signal);
  lab.markSettled("ECANCELED");
  host.resolve(response);
  assert.equal(await bounded(canceled.promise), signal.reason);
  assert.equal(body.locked, false);
  assert.equal(cancellations, 1);
  assert.equal(pulls, 0);
  cleanup.reject(new Error("late body cleanup rejection"));
  await turn();
  lab.events.push("late-body:cancel=1:pull=0:unlocked:cleanup-rejection-observed");
  assert.deepEqual(lab.mock.files.get("/input"), bytes("input unchanged"));
  assert.deepEqual(lab.operations.map(operation => operation.method), ["PROPFIND", "GET"]);
  lab.assertPolicy();
});

type LockVariant = "valid" | "cleanup-timeout" | "malformed" | "foreign" | "redirected" | "absent" | "failed-status";

async function lateLock(lab: Lab, variant: LockVariant): Promise<void> {
  const acquired = deferred<{ response: Response; signal: AbortSignal; token: string }>();
  const host = deferred<Response>();
  const canceled = deferred<void>();
  const unlockHost = deferred<Response>();
  const unlocked = deferred<void>();
  const unlockAborted = deferred<void>();
  const shouldUnlock = variant === "valid" || variant === "cleanup-timeout";
  const deadline = variant === "cleanup-timeout";
  let heldResponse: Response | undefined;
  let bodyCancellations = 0;
  let bodyPulls = 0;
  let unlockEntered = false;
  const fs = lab.adapter(async (url, init) => {
    if (init.method === "LOCK") {
      assert.equal(url, destinationUrl);
      assert.equal(new Headers(init.headers).get("Depth"), "infinity");
      const granted = await lab.mock.fetch(url, init);
      assert.equal(granted.status, 200);
      const token = granted.headers.get("Lock-Token")!;
      const payload = new Uint8Array(await granted.arrayBuffer());
      const headers = new Headers(granted.headers);
      if (variant === "malformed") headers.set("Lock-Token", "<urn:independent:has space>");
      if (variant === "absent") headers.delete("Lock-Token");
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { bodyPulls++; controller.enqueue(payload); controller.close(); },
        cancel() { bodyCancellations++; canceled.resolve(); },
      }, { highWaterMark: 0 });
      heldResponse = new Response(body, { status: variant === "failed-status" ? 423 : 200, headers });
      Object.defineProperty(heldResponse, "url", { value: variant === "foreign" ? "http://foreign.invalid/dav/target%20%C3%BC/" : destinationUrl });
      if (variant === "redirected") Object.defineProperty(heldResponse, "redirected", { value: true });
      acquired.resolve({ response: heldResponse, signal: init.signal!, token });
      return host.promise;
    }
    if (init.method === "UNLOCK") {
      assert.ok(shouldUnlock, "untrusted response must not authorize UNLOCK");
      assert.equal(url, destinationUrl);
      if (deadline) {
        unlockEntered = true;
        init.signal!.addEventListener("abort", () => unlockAborted.resolve(), { once: true });
        return unlockHost.promise;
      }
      const response = await lab.mock.fetch(url, init);
      assert.equal(response.status, 204);
      unlocked.resolve();
      return response;
    }
    assert.equal(init.method, "PROPFIND", "no normal mutation or revalidation resumes after cancellation");
    return lab.mock.fetch(url, init);
  }, deadline ? 60 : 5000);
  const operation = observed(fs.rename("/source", destination, { signal: lab.controller.signal }));
  lab.cleanups.push(async () => {
    if (heldResponse) host.resolve(heldResponse);
    else host.reject(new Error("fixture teardown before LOCK"));
    if (unlockEntered) unlockHost.reject(new Error("late UNLOCK host rejection"));
    await operation;
    if (heldResponse) lab.dispose(heldResponse);
  });
  const granted = await bounded(acquired.promise);
  assert.equal(lab.mock.locks.has(destination), true, "remote lock accepted before caller settlement");
  if (!deadline) lab.abort();
  await failure(operation, deadline ? "ETIMEDOUT" : "ECANCELED", granted.signal);
  lab.markSettled(deadline ? "ETIMEDOUT" : "ECANCELED");
  assert.equal(lab.mock.locks.has(destination), true, "outward cancellation is not remote lock rollback");
  assert.equal(lab.operations.filter(operation => operation.method === "UNLOCK").length, 0);
  host.resolve(granted.response);
  await bounded(canceled.promise);
  if (variant === "valid") await bounded(unlocked.promise);
  if (deadline) {
    await bounded(unlockAborted.promise);
    unlockHost.reject(new Error("late UNLOCK host rejection"));
    lab.events.push("best-effort-UNLOCK:own-deadline:host-late-rejection:remote-lock-retained");
  }
  await turn();
  await turn();
  const unlocks = lab.operations.filter(operation => operation.method === "UNLOCK");
  assert.equal(unlocks.length, shouldUnlock ? 1 : 0);
  if (shouldUnlock) assert.equal(unlocks[0]!.token, granted.token);
  lab.assertPolicy(shouldUnlock ? 1 : 0);
  assert.deepEqual(lab.operations.map(operation => operation.method), shouldUnlock
    ? ["PROPFIND", "PROPFIND", "LOCK", "UNLOCK"] : ["PROPFIND", "PROPFIND", "LOCK"]);
  assert.equal(lab.mock.locks.has(destination), variant !== "valid");
  assert.equal(bodyCancellations, 1);
  assert.equal(bodyPulls, 0, "late cleanup validates response metadata/header, not lock XML");
  assert.equal(granted.response.body!.locked, false);
  assert.deepEqual([...lab.mock.files.keys()].sort(), ["/", "/input", "/source", "/source/child", destination].sort());
  assert.deepEqual(lab.mock.files.get("/source/child"), bytes("preserve"));
  assert.equal(lab.mock.files.get(destination), null);
  lab.events.push(`late-lock:${variant}:body-cancel=1:body-pull=0:unlocks=${unlocks.length}:namespace-unchanged`);
}

check("V04 valid late LOCK unlocks exact encoded collection URL with granted token", lab => lateLock(lab, "valid"));
check("V05 deadline late LOCK cleanup has independent deadline and cannot guarantee release", lab => lateLock(lab, "cleanup-timeout"));
check("V06 malformed late LOCK token cannot authorize cleanup", lab => lateLock(lab, "malformed"));
check("V07 foreign response URL cannot authorize late LOCK cleanup", lab => lateLock(lab, "foreign"));
check("V08 followed redirect cannot authorize late LOCK cleanup", lab => lateLock(lab, "redirected"));
check("V09 absent late LOCK token cannot authorize cleanup", lab => lateLock(lab, "absent"));
check("V10 unsuccessful late LOCK status cannot authorize cleanup", lab => lateLock(lab, "failed-status"));
