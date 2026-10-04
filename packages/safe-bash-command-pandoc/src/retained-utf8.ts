import type {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, emptyText} from "./backed-text.js";
import type {ExecutionContext} from "./execution.js";
import type {Limits} from "./types.js";

/** Finish decoding and input accounting before parsing, without retaining the
 * decoded document in memory. Reuse the native decoder's byte/error ordering. */
export async function* retainedUtf8(chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>, context: ExecutionContext, storage: PagedStorage, budgets: readonly (keyof Limits)[] = [], decoded?: () => void, assembled = false): AsyncGenerator<string> {
  const text = new BackedText(storage, units => context.cooperate(units)), value = emptyText();
  await context.decodeUtf8To(chunks, async chunk => {await text.append(value, await text.from([chunk]));}, budgets, !assembled);
  if (assembled) context.charge("retainedBytes", value.units * 2);
  decoded?.();
  yield* text.chunks(value);
}
