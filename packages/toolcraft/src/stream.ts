import { validate, type AnySchema, type Static } from "toolcraft-schema";
import { UserError } from "./user-error.js";

export type StreamStatusType = "connected" | "progress" | "reconnecting";

export interface StreamStatusEvent {
  type: StreamStatusType;
  message?: string;
}

export interface StreamConsumerOptions {
  signal?: AbortSignal;
  onStatus?: (event: StreamStatusEvent) => void;
}

export interface ToolcraftStream<TEvent> extends AsyncIterable<TEvent> {
  readonly signal: AbortSignal;
  cancel(reason?: unknown): Promise<void>;
}

export interface ManagedStreamOptions<TSchema extends AnySchema> extends StreamConsumerOptions {
  eventSchema: TSchema;
  create(signal: AbortSignal, status: (event: StreamStatusEvent) => void): Promise<AsyncIterable<Static<TSchema>>>;
}

function validationMessage(schema: AnySchema, value: unknown): string | undefined {
  const result = validate(schema, value);
  return result.ok ? undefined : result.issues.map((issue) => issue.message).join("; ");
}

export function createManagedStream<TSchema extends AnySchema>(
  options: ManagedStreamOptions<TSchema>
): ToolcraftStream<Static<TSchema>> {
  const controller = new AbortController();
  let iteratorPromise: Promise<AsyncIterator<Static<TSchema>>> | undefined;
  let closePromise: Promise<void> | undefined;
  let done = false;

  const getIterator = (): Promise<AsyncIterator<Static<TSchema>>> => {
    iteratorPromise ??= Promise.resolve()
      .then(() => options.create(controller.signal, (event) => options.onStatus?.(event)))
      .then((iterable) => iterable[Symbol.asyncIterator]());
    return iteratorPromise;
  };

  const close = (reason?: unknown): Promise<void> => {
    if (closePromise !== undefined) {
      return closePromise;
    }
    const closingIterator = done ? undefined : iteratorPromise;
    done = true;
    options.signal?.removeEventListener("abort", abortFromConsumer);
    closePromise = closingIterator === undefined
      ? Promise.resolve()
      : closingIterator.then(async (activeIterator) => {
        await activeIterator.return?.();
      }, () => undefined);
    controller.abort(reason);
    return closePromise;
  };

  const abortFromConsumer = (): void => {
    void close(options.signal?.reason).catch(() => undefined);
  };
  if (options.signal?.aborted === true) {
    abortFromConsumer();
  } else {
    options.signal?.addEventListener("abort", abortFromConsumer, { once: true });
  }

  const stream: ToolcraftStream<Static<TSchema>> = {
    signal: controller.signal,
    cancel: close,
    [Symbol.asyncIterator](): AsyncIterator<Static<TSchema>> {
      return {
        async next() {
          if (done || controller.signal.aborted) {
            await close(controller.signal.reason);
            return { done: true, value: undefined };
          }
          let result: IteratorResult<Static<TSchema>>;
          try {
            const activeIterator = await getIterator();
            if (done || controller.signal.aborted) {
              await close(controller.signal.reason);
              return { done: true, value: undefined };
            }
            result = await activeIterator.next();
          } catch (error) {
            await close(error);
            throw error;
          }
          if (controller.signal.aborted) {
            await close(controller.signal.reason);
            return { done: true, value: undefined };
          }
          if (result.done === true) {
            done = true;
            options.signal?.removeEventListener("abort", abortFromConsumer);
            return { done: true, value: undefined };
          }
          const message = validationMessage(options.eventSchema, result.value);
          if (message !== undefined) {
            await close(new UserError(message));
            throw new UserError(message);
          }
          return { done: false, value: result.value };
        },
        async return() {
          await close();
          return { done: true, value: undefined };
        },
        async throw(error?: unknown) {
          await close(error);
          throw error;
        }
      };
    }
  };

  return stream;
}
