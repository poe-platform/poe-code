export type JobOutcome = Readonly<{ kind: "status"; status: number } | { kind: "failure"; reason: unknown }>;
export type JobCleanup = () => void | Promise<void>;

export interface JobTaskContext {
  readonly signal: AbortSignal;
  registerCleanup(cleanup: JobCleanup): void;
}

export interface PreparedJob {
  run(): number | Promise<number>;
}

export interface JobHandle {
  readonly jobId: number;
  readonly completion: Promise<JobOutcome>;
}

export type JobTarget = Readonly<{ handle: JobHandle } | { jobId: number }>;
export interface JobWaitOptions { readonly signal?: AbortSignal }
export interface JobWaitResult {
  readonly outcome: JobOutcome;
  readonly handle?: JobHandle;
  readonly unknown: readonly JobTarget[];
}

export interface JobSnapshot {
  readonly handle: JobHandle;
  readonly listed: boolean;
  readonly notified: boolean;
  readonly residency: "active-unnotified" | "active-notified" | "saved";
  readonly state: "preparing" | "running" | "done";
  readonly outcome?: JobOutcome;
}

export interface JobStateOptions {
  readonly maxJobs?: number;
  readonly maxWaiters?: number;
  readonly maxCleanupsPerJob?: number;
  readonly signal?: AbortSignal;
  readonly registerCleanup?: (cleanup: () => Promise<void>) => void;
}

export interface JobState {
  start(prepare: (context: JobTaskContext) => PreparedJob | Promise<PreparedJob>): Promise<JobHandle>;
  snapshot(): readonly JobSnapshot[];
  retireNotified(): void;
  savedStatus(handle: JobHandle): number | undefined;
  wait(targets?: readonly JobTarget[], options?: JobWaitOptions): Promise<JobWaitResult>;
  waitNext(targets?: readonly JobTarget[], options?: JobWaitOptions): Promise<JobWaitResult>;
  finish(): Promise<void>;
  close(reason?: unknown): Promise<void>;
}

interface JobRecord {
  readonly handle: JobHandle;
  readonly controller: AbortController;
  readonly cleanups: JobCleanup[];
  readonly cleanupFailures: unknown[];
  readonly complete: (outcome: JobOutcome) => void;
  listed: boolean;
  notified: boolean;
  saved: boolean;
  state: JobSnapshot["state"];
  outcome?: JobOutcome;
  cleaning?: Promise<void>;
}

interface JobLimits {
  readonly maxJobs: number;
  readonly maxWaiters: number;
  readonly maxCleanupsPerJob: number;
}

class JobRegistry implements JobState {
  readonly #records = new Map<JobHandle, JobRecord>();
  readonly #jobs = new Map<number, JobRecord>();
  readonly #listeners = new Set<() => void>();
  readonly #owner: AbortSignal | undefined;
  readonly #abortOwner: () => void;
  #accepting = true;
  #cancelling = false;
  #finished = false;
  #waiters = 0;
  #terminal: Promise<void> | undefined;

  constructor(readonly limits: JobLimits, options: JobStateOptions) {
    this.#owner = options.signal;
    this.#abortOwner = () => { void this.close(this.#owner!.reason).catch(() => {}); };
    options.registerCleanup?.(() => this.#terminal ?? this.close());
    if (this.#owner?.aborted) this.#abortOwner();
    else this.#owner?.addEventListener("abort", this.#abortOwner, { once: true });
  }

  async start(prepare: (context: JobTaskContext) => PreparedJob | Promise<PreparedJob>): Promise<JobHandle> {
    this.#owner?.throwIfAborted();
    if (!this.#accepting) throw new Error("job state is closed to admission");
    if (typeof prepare !== "function") throw new TypeError("job preparation must be a function");
    if (this.#records.size >= this.limits.maxJobs) throw new Error("job limit exceeded: maxJobs");
    const occupied = [...this.#records.values()].filter(record => record.state === "preparing" || record.listed && !this.#canRetire(record));
    const jobId = Math.max(0, ...occupied.map(record => record.handle.jobId)) + 1;
    if (!Number.isSafeInteger(jobId)) throw new Error("job ID exhausted");
    let complete!: (outcome: JobOutcome) => void;
    const completion = new Promise<JobOutcome>(resolve => { complete = resolve; });
    const handle = Object.freeze({ jobId, completion });
    const record: JobRecord = {
      handle, complete, controller: new AbortController(), cleanups: [], cleanupFailures: [],
      listed: false, notified: false, saved: false, state: "preparing",
    };
    this.#records.set(handle, record);
    this.#notify();
    const context: JobTaskContext = Object.freeze({
      signal: record.controller.signal,
      registerCleanup: (cleanup: JobCleanup): void => {
        if (record.cleaning || record.controller.signal.aborted || record.state === "done") throw new Error("job cleanup admission is closed");
        if (typeof cleanup !== "function") throw new TypeError("job cleanup must be a function");
        if (record.cleanups.length >= this.limits.maxCleanupsPerJob) throw new Error("job limit exceeded: maxCleanupsPerJob");
        record.cleanups.push(cleanup);
      },
    });
    let run: (() => number | Promise<number>) | undefined;
    let failure: { reason: unknown } | undefined;
    try {
      const prepared = await prepare(context);
      if (!record.controller.signal.aborted) {
        const runner = prepared?.run;
        if (typeof runner !== "function") throw new TypeError("job preparation must return a runner");
        run = () => Reflect.apply(runner, prepared, []);
      }
    } catch (reason) { failure = { reason }; }
    if (failure || record.controller.signal.aborted) {
      await this.#settle(record, failure);
      this.#forget(record);
      throw (record.outcome as Extract<JobOutcome, { kind: "failure" }>).reason;
    }
    this.retireNotified();
    record.listed = true;
    this.#jobs.set(jobId, record);
    this.#notify();
    queueMicrotask(() => { void this.#execute(record, run!); });
    return handle;
  }

  async #execute(record: JobRecord, run: () => number | Promise<number>): Promise<void> {
    let result = 0;
    let failure: { reason: unknown } | undefined;
    if (!record.controller.signal.aborted) {
      record.state = "running";
      this.#notify();
      try {
        result = await run();
        if (!Number.isInteger(result) || result < 0 || result > 255) throw new TypeError("job exit status must be an integer from 0 to 255");
      } catch (reason) { failure = { reason }; }
    }
    await this.#settle(record, failure, result);
  }

  #clean(record: JobRecord): Promise<void> {
    if (!record.cleaning) {
      record.cleaning = Promise.resolve().then(async () => {
        const results = await Promise.allSettled(record.cleanups.map(async cleanup => cleanup()));
        for (const result of results) if (result.status === "rejected") record.cleanupFailures.push(result.reason);
        record.cleanups.length = 0;
      });
    }
    return record.cleaning;
  }

  async #settle(record: JobRecord, failure?: { reason: unknown }, result = 0): Promise<void> {
    await this.#clean(record);
    let outcome: JobOutcome;
    if (this.#owner?.aborted) outcome = { kind: "failure", reason: this.#owner.reason };
    else if (failure) outcome = { kind: "failure", reason: failure.reason };
    else if (record.controller.signal.aborted) outcome = { kind: "failure", reason: record.controller.signal.reason };
    else if (record.cleanupFailures.length) outcome = { kind: "failure", reason: record.cleanupFailures[0] };
    else outcome = { kind: "status", status: result };
    record.outcome = Object.freeze(outcome);
    record.state = "done";
    record.complete(record.outcome);
    this.#notify();
  }

  #unlist(record: JobRecord): void {
    record.listed = false;
    if (this.#jobs.get(record.handle.jobId) === record) this.#jobs.delete(record.handle.jobId);
  }

  #forget(record: JobRecord): void {
    this.#unlist(record);
    this.#records.delete(record.handle);
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  snapshot(): readonly JobSnapshot[] {
    return Object.freeze([...this.#records.values()].map(record => Object.freeze({
      handle: record.handle, listed: record.listed, notified: record.notified, state: record.state,
      residency: record.saved ? "saved" as const : record.notified ? "active-notified" as const : "active-unnotified" as const,
      ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
    })));
  }

  #canRetire(record: JobRecord): boolean {
    return !record.saved && record.state === "done" && record.notified && record.outcome?.kind === "status";
  }

  retireNotified(): void {
    let changed = false;
    for (const record of this.#records.values()) {
      if (this.#canRetire(record)) {
        record.saved = true;
        this.#unlist(record);
        changed = true;
      }
    }
    if (changed) this.#notify();
  }

  savedStatus(handle: JobHandle): number | undefined {
    const record = this.#records.get(handle);
    return record?.saved && record.outcome?.kind === "status" ? record.outcome.status : undefined;
  }

  #targets(targets: readonly JobTarget[] | undefined): readonly JobTarget[] | undefined {
    if (targets === undefined) return undefined;
    if (!Array.isArray(targets)) throw new TypeError("job targets must be an array");
    if (targets.length === 0) return undefined;
    if (targets.length > this.limits.maxJobs) throw new Error("job target limit exceeded");
    const selected: JobTarget[] = [];
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      if (!target || typeof target !== "object" || Reflect.ownKeys(target).length !== 1) throw new TypeError("invalid job target");
      if ("jobId" in target && Number.isSafeInteger(target.jobId) && target.jobId > 0) selected.push(Object.freeze({ jobId: target.jobId }));
      else if ("handle" in target && target.handle && typeof target.handle === "object") selected.push(Object.freeze({ handle: target.handle }));
      else throw new TypeError("invalid job target");
    }
    return selected;
  }

  #lookup(target: JobTarget): JobRecord | undefined {
    return "handle" in target ? this.#records.get(target.handle) : this.#jobs.get(target.jobId);
  }

  #waitSignal(options: JobWaitOptions): AbortSignal | undefined {
    if (!options || typeof options !== "object" || Reflect.ownKeys(options).some(key => key !== "signal")) throw new TypeError("invalid job wait options");
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError("invalid job wait signal");
    options.signal?.throwIfAborted();
    return options.signal;
  }

  #changed(signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { this.#listeners.delete(changed); signal?.removeEventListener("abort", aborted); };
      const changed = () => { cleanup(); resolve(); };
      const aborted = () => { cleanup(); reject(signal!.reason); };
      this.#listeners.add(changed);
      if (signal?.aborted) aborted();
      else signal?.addEventListener("abort", aborted, { once: true });
    });
  }

  async wait(targets?: readonly JobTarget[], options: JobWaitOptions = {}): Promise<JobWaitResult> {
    const selected = this.#targets(targets);
    const signal = this.#waitSignal(options);
    if (this.#waiters >= this.limits.maxWaiters) throw new Error("job limit exceeded: maxWaiters");
    this.#waiters++;
    const unknown: JobTarget[] = [];
    let outcome: JobOutcome = Object.freeze({ kind: "status", status: 0 });
    let failure: JobOutcome | undefined;
    try {
      if (selected === undefined) {
        const records = [...this.#records.values()];
        for (const record of records) {
          while (record.state !== "done") { signal?.throwIfAborted(); await this.#changed(signal); }
          if (record.outcome!.kind === "failure") failure ??= record.outcome;
        }
        signal?.throwIfAborted();
        for (const record of records) this.#forget(record);
      } else for (const target of selected) {
        signal?.throwIfAborted();
        const record = this.#lookup(target);
        if (!record) {
          unknown.push(target);
          outcome = Object.freeze({ kind: "status", status: 127 });
          continue;
        }
        while (record.state !== "done") { signal?.throwIfAborted(); await this.#changed(signal); }
        signal?.throwIfAborted();
        if (!record.saved) this.retireNotified();
        record.notified = true;
        if ("handle" in target) this.#unlist(record);
        outcome = record.outcome!;
        if (outcome.kind === "failure") failure ??= outcome;
        this.#notify();
      }
      return Object.freeze({ outcome: failure ?? outcome, unknown: Object.freeze(unknown) });
    } finally { this.#waiters--; }
  }

  async waitNext(targets?: readonly JobTarget[], options: JobWaitOptions = {}): Promise<JobWaitResult> {
    const selected = this.#targets(targets);
    const signal = this.#waitSignal(options);
    if (this.#waiters >= this.limits.maxWaiters) throw new Error("job limit exceeded: maxWaiters");
    this.#waiters++;
    const unknown: JobTarget[] = [];
    const records = new Set<JobRecord>();
    if (selected === undefined) {
      for (const record of this.#records.values()) if (!record.saved) records.add(record);
    }
    else for (const target of selected) {
      const record = this.#lookup(target);
      if (!record || record.saved) unknown.push(target);
      else records.add(record);
    }
    try {
      for (;;) {
        signal?.throwIfAborted();
        const eligible = [...records].filter(record => !record.saved && !record.notified).sort((first, second) => first.handle.jobId - second.handle.jobId);
        const ready = eligible.find(record => record.state === "done");
        if (ready) {
          ready.notified = true;
          ready.saved = ready.outcome!.kind === "status";
          this.#unlist(ready);
          this.#notify();
          return Object.freeze({ outcome: ready.outcome!, handle: ready.handle, unknown: Object.freeze(unknown) });
        }
        if (!eligible.length) return Object.freeze({ outcome: Object.freeze({ kind: "status", status: 127 }), unknown: Object.freeze(unknown) });
        await this.#changed(signal);
      }
    } finally { this.#waiters--; }
  }

  finish(): Promise<void> {
    this.#accepting = false;
    return this.#drain();
  }

  close(reason: unknown = new Error("job state closed")): Promise<void> {
    this.#accepting = false;
    if (!this.#finished && !this.#cancelling) {
      this.#cancelling = true;
      for (const record of this.#records.values()) if (record.state !== "done") {
        record.controller.abort(reason);
        void this.#clean(record);
      }
    }
    return this.#drain();
  }

  #drain(): Promise<void> {
    if (!this.#terminal) {
      const records = [...this.#records.values()];
      this.#terminal = (async () => {
        try {
          await Promise.all(records.map(record => record.handle.completion));
          if (!this.#cancelling) {
            const failure = records.find(record => record.outcome?.kind === "failure");
            if (failure?.outcome?.kind === "failure") throw failure.outcome.reason;
          }
          const errors = records.flatMap(record => record.cleanupFailures);
          if (errors.length) throw new AggregateError(errors, "job cleanup failed");
        } finally {
          this.#finished = true;
          this.#owner?.removeEventListener("abort", this.#abortOwner);
        }
      })();
      void this.#terminal.catch(() => {});
    }
    return this.#terminal;
  }
}

export function createJobState(options: JobStateOptions = {}): JobState {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("invalid job options");
  const limits = { maxJobs: 256, maxWaiters: 64, maxCleanupsPerJob: 64 };
  for (const key of Reflect.ownKeys(options)) {
    if (key === "signal" || key === "registerCleanup") continue;
    if (typeof key !== "string" || !Object.hasOwn(limits, key)) throw new TypeError("unknown job option");
    const name = key as keyof JobLimits;
    const value = options[name];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1 || value > limits[name]) throw new TypeError(`invalid job limit: ${key}`);
    limits[name] = value;
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError("invalid job owner signal");
  if (options.registerCleanup !== undefined && typeof options.registerCleanup !== "function") throw new TypeError("invalid job owner cleanup registration");
  return new JobRegistry(Object.freeze(limits), options);
}
