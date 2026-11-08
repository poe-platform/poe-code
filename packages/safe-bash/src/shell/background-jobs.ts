import type { ByteSink } from '../contracts/index.js';
import type { InvocationScope } from './cleanup.js';

export const backgroundPrune = Symbol('background initial redirections');
const destinations = new WeakMap<ByteSink, ByteSink>();
export function backgroundDestination(sink: ByteSink): ByteSink { return destinations.get(sink) ?? sink; }
export function forwardBackgroundDestination(output: ByteSink, source: ByteSink): void { destinations.set(output, backgroundDestination(source)); }

export const backgroundResources = Symbol('background descriptor resources');

/** Descriptor closure follows inherited writers, independently of job exit status. */
export class BackgroundResources {
  destination?: ByteSink;
  #users = 0;
  #resolve: (() => void) | undefined;
  #pending: Promise<void> | undefined;
  retain(): () => void {
    this.#users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.#users === 0) { this.#resolve?.(); this.#resolve = undefined; this.#pending = undefined; }
    };
  }
  get busy(): boolean { return this.#users !== 0; }
  drain(): Promise<void> {
    return this.#users ? this.#pending ??= new Promise(resolve => { this.#resolve = resolve; }) : Promise.resolve();
  }
}

export class BackgroundExecution {
  #next = 1;
  readonly #pending = new Set<Promise<unknown>>();
  readonly #failures: unknown[] = [];
  constructor(readonly scope: InvocationScope, readonly admit: () => void) {}
  identifier(): string { this.admit(); return String(this.#next++); }
  track<T>(promise: Promise<T>): Promise<T> {
    this.#pending.add(promise);
    void promise.then(() => { this.#pending.delete(promise); }, error => { this.#pending.delete(promise); this.#failures.push(error); });
    return promise;
  }
  async drain(): Promise<void> {
    while (this.#pending.size) await Promise.allSettled([...this.#pending]);
    if (this.#failures.length) throw this.#failures[0];
  }
}

export interface BackgroundJob {
  readonly id: string;
  readonly number: number;
  readonly promise: Promise<number>;
  done: boolean;
  consumed: boolean;
  waited: boolean;
}

export class BackgroundJobs {
  readonly jobs = new Map<string, BackgroundJob>();
  constructor(readonly execution: BackgroundExecution) {}
  launch(id: string, work: () => Promise<number>): string {
    const promise = this.execution.track(Promise.resolve().then(work));
    let number = 1;
    for (const existing of this.jobs.values()) if (!existing.consumed) number = Math.max(number, existing.number + 1);
    const job: BackgroundJob = { id, number, promise, done: false, consumed: false, waited: false };
    this.jobs.set(id, job);
    void promise.then(() => { job.done = true; }, () => { job.done = true; });
    return id;
  }
  resolve(value: string): BackgroundJob | undefined {
    if (!value.startsWith('%')) return /^[0-9]+$/u.test(value) ? this.jobs.get(String(Number(value))) : undefined;
    const active = [...this.jobs.values()].filter(job => !job.consumed);
    if (['%', '%%', '%+'].includes(value)) return active.at(-1);
    if (value === '%-') return active.at(-2);
    if (!/^%[0-9]+$/u.test(value)) return undefined;
    const number = Number(value.slice(1));
    return active.find(job => job.number === number);
  }
}
