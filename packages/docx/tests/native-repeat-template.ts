import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, onTestFinished } from "vitest";
import type { ArchiveLimits } from "../src/archive.js";
import type { DocumentLimits } from "../src/budget.js";

interface NativeRequest {
  readonly input: string;
  readonly route: "native-sdk" | "native-sdk-batch" | "native-cli" | "native-cli-batch";
  readonly operation: "controls.repeat" | "template.apply" | "revisions.accept" | "revisions.reject";
  readonly limits: ArchiveLimits;
  readonly documentLimits: Partial<DocumentLimits>;
  readonly allowed: boolean;
}
interface NativeResponse {
  readonly type: "result";
  readonly id: number;
  readonly ok: boolean;
  readonly output?: string;
  readonly error?: string;
  readonly stack?: string;
  readonly result?: unknown;
}

/** One native main thread per matrix; the fixture owns fresh state per request. */
export function nativeRepeatTemplate<Request = NativeRequest>(fixture = new URL("./fixtures/repeat-template-native.mjs", import.meta.url)): (request: Request) => Promise<NativeResponse & { readonly receipt: { readonly drained: boolean } }> {
  let child: ReturnType<typeof spawn>;
  let closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  let pending: { id: number; resolve: (value: NativeResponse) => void; reject: (error: Error) => void } | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let fatal: Error | undefined;
  let nextId = 0, ready = false, stopping = false, acknowledged = false;
  let stderr = "";

  function failNative(error: Error): void {
    fatal ??= error;
    rejectReady?.(fatal);
    pending?.reject(fatal);
    pending = undefined;
    child?.kill("SIGKILL");
  }

  beforeAll(async () => {
    child = spawn(process.execPath, [...(fixture.pathname.endsWith(".ts") ? ["--import", "tsx"] : []), fileURLToPath(fixture)], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let resolveReady!: () => void;
    const startup = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    closed = new Promise(resolve => child.on("close", (code, signal) => {
      if (!stopping || !acknowledged || pending || code !== 0 || signal !== null)
        failNative(new Error(`Native child closed incompletely: code=${code}, signal=${signal}\n${stderr}`));
      resolve({ code, signal });
    }));
    child.stderr!.setEncoding("utf8").on("data", bytes => { stderr += bytes; });
    child.stdout!.on("data", () => { failNative(new Error("Unexpected native stdout outside its response")); });
    child.on("error", failNative);
    child.on("message", message => {
      if (!message || typeof message !== "object") return failNative(new Error("Invalid native response"));
      const response = message as { type?: string; id?: number };
      if (response.type === "ready" && !ready && !stopping && !fatal) {
        ready = true;
        resolveReady();
      } else if (response.type === "closed" && stopping && !acknowledged && !pending && response.id === nextId) {
        acknowledged = true;
      } else if (response.type === "result" && ready && !stopping && pending !== undefined && pending.id === response.id) {
        const completed = pending;
        pending = undefined;
        completed.resolve(message as NativeResponse);
      } else failNative(new Error("Duplicate, mismatched or unexpected native response"));
    });
    const timer = setTimeout(() => { failNative(new Error("Native child did not become ready")); }, 5000);
    try { await startup; }
    catch (error) { failNative(error as Error); await closed; throw error; }
    finally { clearTimeout(timer); }
  });

  afterAll(async () => {
    if (!child) return;
    if (!fatal) {
      if (pending) failNative(new Error("Native request unfinished at shutdown"));
      else {
        stopping = true;
        child.send({ type: "shutdown", id: nextId }, error => { if (error) failNative(error); });
      }
    }
    const timer = setTimeout(() => { failNative(new Error("Native child did not finish shutdown")); }, 5000);
    let outcome: Awaited<typeof closed>;
    try { outcome = await closed; } finally { clearTimeout(timer); }
    if (fatal) throw fatal;
    expect(acknowledged).toBe(true);
    expect(outcome).toEqual({ code: 0, signal: null });
  });

  return async request => {
    if (fatal) throw fatal;
    if (!ready || stopping || pending) throw new Error("Native child is not available for this case");
    const id = ++nextId, receipt = { drained: false };
    let responded = false;
    onTestFinished(async () => {
      if (pending?.id === id) {
        failNative(new Error("Native matrix case ended with an unfinished request"));
        await closed;
      }
      if (fatal) throw fatal;
      if (!responded || pending) throw new Error("Native request did not drain completely");
      receipt.drained = true;
    });
    const response = await new Promise<NativeResponse>((resolve, reject) => {
      pending = { id, resolve, reject };
      child.send({ type: "execute", id, ...request }, error => { if (error) failNative(error); });
    });
    responded = true;
    return { ...response, receipt };
  };
}
