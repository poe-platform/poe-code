import type { AnySchema, Static } from "toolcraft-schema";
import type { StreamConsumerOptions, StreamStatusEvent, ToolcraftStream } from "./definitions.js";

export interface ManagedStreamOptions<TSchema extends AnySchema> extends StreamConsumerOptions {
  eventSchema: TSchema;
  create(signal: AbortSignal, status: (event: StreamStatusEvent) => void): Promise<AsyncIterable<Static<TSchema>>>;
}

export declare function createManagedStream<TSchema extends AnySchema>(
  options: ManagedStreamOptions<TSchema>
): ToolcraftStream<Static<TSchema>>;
