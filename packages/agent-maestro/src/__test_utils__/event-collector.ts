import type { MaestroEvent, RunMaestroOptions } from "../index.js";

export interface EventCollector {
  onEvent: NonNullable<RunMaestroOptions["onEvent"]>;
  events: MaestroEvent[];
  waitFor(
    predicate: (event: MaestroEvent) => boolean,
    options: { timeoutMs: number }
  ): Promise<MaestroEvent>;
  snapshot(): readonly MaestroEvent[];
}

interface Waiter {
  predicate: (event: MaestroEvent) => boolean;
  resolve(event: MaestroEvent): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export function createEventCollector(): EventCollector {
  const events: MaestroEvent[] = [];
  const waiters: Waiter[] = [];

  const onEvent: NonNullable<RunMaestroOptions["onEvent"]> = (event) => {
    events.push(event);

    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) {
        continue;
      }

      settleWaiter(waiters, waiter);
      waiter.resolve(event);
    }
  };

  return {
    onEvent,
    events,
    waitFor(predicate, options) {
      const existing = events.find(predicate);
      if (existing !== undefined) {
        return Promise.resolve(existing);
      }

      return new Promise((resolve, reject) => {
        const waiter: Waiter = {
          predicate,
          resolve,
          reject,
          timeout: setTimeout(() => {
            settleWaiter(waiters, waiter);
            reject(new Error(`Timed out waiting for maestro event after ${options.timeoutMs}ms.`));
          }, options.timeoutMs)
        };
        waiters.push(waiter);
      });
    },
    snapshot() {
      return Object.freeze([...events]);
    }
  };
}

function settleWaiter(waiters: Waiter[], waiter: Waiter): void {
  clearTimeout(waiter.timeout);
  const index = waiters.indexOf(waiter);
  if (index >= 0) {
    waiters.splice(index, 1);
  }
}
