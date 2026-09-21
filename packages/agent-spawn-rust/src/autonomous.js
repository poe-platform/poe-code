import { native } from "./native.js";
import { isActivityTimeoutError } from "./spawn.js";

export function createSpawnAutonomous(consumeEvents) {
  return async (streamSpawn, options) => {
    const {
      service,
      maxTimeoutRetries = 3,
      activityTimeoutMs = 600000,
      ...rest
    } = options;
    const state = new native.NativeSpawnAutonomous(maxTimeoutRetries);
    const spawnOptions = { ...rest, activityTimeoutMs };
    while (true) {
      let result;
      try {
        const stream = streamSpawn(service, spawnOptions);
        result = stream.result;
        // Promise.all observes both tasks without waiting for a pending consumer
        // after the result fails. The catch below also observes a result when
        // entering the consumer throws synchronously.
        const [value] = await Promise.all([result, consumeEvents(stream.events)]);
        return value;
      } catch (error) {
        result?.catch(() => {});
        if (!state.retry(isActivityTimeoutError(error))) throw error;
      }
    }
  };
}
