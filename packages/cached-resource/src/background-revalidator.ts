export interface Revalidator {
  trigger(key: string, revalidate: () => Promise<void>): void;
  waitForRevalidation(key?: string): Promise<void>;
}

export function createRevalidator(): Revalidator {
  const inflight = new Map<string, Promise<void>>();

  return {
    trigger(key, revalidate) {
      if (inflight.has(key)) return;

      let resolveRevalidation!: () => void;
      let rejectRevalidation!: (error: unknown) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolveRevalidation = resolve;
        rejectRevalidation = reject;
      })
        .catch(() => {})
        .finally(() => inflight.delete(key));

      inflight.set(key, promise);
      try {
        void revalidate().then(resolveRevalidation, rejectRevalidation);
      } catch (error) {
        rejectRevalidation(error);
      }
    },

    async waitForRevalidation(key?) {
      if (key) {
        await inflight.get(key);
      } else {
        while (inflight.size > 0) {
          await Promise.all(inflight.values());
        }
      }
    },
  };
}
