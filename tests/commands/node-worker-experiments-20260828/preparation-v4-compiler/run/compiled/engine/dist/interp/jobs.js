import { AsyncLocalStorage } from "node:async_hooks";
const activeJob = new AsyncLocalStorage();
export class SandboxJobQueue {
    running = false;
    pending = [];
    idle = [];
    generation = 0;
    acquire(job) {
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
    release(job) {
        job.prefixParent = undefined;
        if (!job.ownsExecution)
            return;
        job.ownsExecution = false;
        this.running = false;
        this.advance();
    }
    async run(task) {
        const job = { queue: this, ownsExecution: false };
        await this.acquire(job);
        return activeJob.run(job, async () => {
            try {
                return await task();
            }
            finally {
                this.release(job);
            }
        });
    }
    async drain() {
        let idleTurns = 0;
        while (idleTurns < 20) {
            const generation = this.generation;
            if (this.running)
                await new Promise((resolve) => this.idle.push(resolve));
            await Promise.resolve();
            idleTurns = generation === this.generation ? idleTurns + 1 : 0;
        }
    }
    advance() {
        if (this.running)
            return;
        const next = this.pending.shift();
        if (next !== undefined) {
            next();
        }
        else {
            for (const resolve of this.idle.splice(0))
                resolve();
        }
    }
}
export function runPromiseJob(task) {
    const job = activeJob.getStore();
    return job === undefined ? Promise.resolve().then(task) : job.queue.run(task);
}
export function runAsyncPrefix(task) {
    const parent = activeJob.getStore();
    if (parent === undefined)
        return task();
    let owner = parent;
    while (owner !== undefined && !owner.ownsExecution)
        owner = owner.prefixParent;
    if (owner === undefined)
        return parent.queue.run(task);
    const job = { queue: parent.queue, ownsExecution: false, prefixParent: parent };
    return activeJob.run(job, async () => {
        try {
            return await task();
        }
        finally {
            job.queue.release(job);
        }
    });
}
export async function suspendJob(pending) {
    const job = activeJob.getStore();
    if (job === undefined)
        return pending;
    job.queue.release(job);
    try {
        return await pending;
    }
    finally {
        await job.queue.acquire(job);
    }
}
