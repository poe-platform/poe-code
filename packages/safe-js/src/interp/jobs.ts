import { AsyncLocalStorage } from "node:async_hooks";

type ExecutionJob = {
  queue: SandboxJobQueue;
  ownsExecution: boolean;
  prefixParent?: ExecutionJob;
};

const activeJob = new AsyncLocalStorage<ExecutionJob>();

export class SandboxJobQueue {
  private running = false;
  private pending: Array<() => void> = [];
  private ready: Array<() => void> = [];
  private readonly idle: Array<() => void> = [];
  private generation = 0;

  acquire(job: ExecutionJob): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push(() => {
        this.running = true;
        this.generation += 1;
        job.ownsExecution = true;
        resolve();
      });
      this.advance();
    });
  }

  release(job: ExecutionJob): void {
    job.prefixParent = undefined;
    if (!job.ownsExecution) return;
    job.ownsExecution = false;
    this.running = false;
    this.advance();
  }

  async run<T>(task: () => T | Promise<T>): Promise<T> {
    const job = { queue: this, ownsExecution: false };
    await this.acquire(job);
    return activeJob.run(job, async () => {
      try {
        return await task();
      } finally {
        this.release(job);
      }
    });
  }

  async drain(): Promise<void> {
    let idleTurns = 0;
    while (idleTurns < 20) {
      const generation = this.generation;
      if (this.running) await new Promise<void>((resolve) => this.idle.push(resolve));
      await Promise.resolve();
      idleTurns = generation === this.generation ? idleTurns + 1 : 0;
    }
  }

  private advance(): void {
    if (this.running) return;
    if (this.ready.length === 0 && this.pending.length > 0) {
      const empty = this.ready;
      this.ready = this.pending.reverse();
      this.pending = empty;
    }
    const next = this.ready.pop();
    if (next !== undefined) {
      next();
    } else {
      for (const resolve of this.idle.splice(0)) resolve();
    }
  }
}

export function runPromiseJob<T>(task: () => T | Promise<T>): Promise<T> {
  const job = activeJob.getStore();
  return job === undefined ? Promise.resolve().then(task) : job.queue.run(task);
}

export function runAsyncPrefix<T>(task: () => Promise<T>): Promise<T> {
  const parent = activeJob.getStore();
  if (parent === undefined) return task();
  let owner: ExecutionJob | undefined = parent;
  while (owner !== undefined && !owner.ownsExecution) owner = owner.prefixParent;
  if (owner === undefined) return parent.queue.run(task);
  const job = { queue: parent.queue, ownsExecution: false, prefixParent: parent };
  return activeJob.run(job, async () => {
    try {
      return await task();
    } finally {
      job.queue.release(job);
    }
  });
}

export async function suspendJob<T>(pending: Promise<T>): Promise<T> {
  const job = activeJob.getStore();
  if (job === undefined) return pending;
  job.queue.release(job);
  try {
    return await pending;
  } finally {
    await job.queue.acquire(job);
  }
}
