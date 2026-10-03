import { ZipWriteChain } from "@poe-code/office-package";
import type { CapabilityContext, WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import { encodeTextStream } from "@poe-code/spreadsheet-engine/encoding/encode-stream";

/** Stages complete XML fragments discovered before their document position. */
export function createOdfXmlTape(context: CapabilityContext, storage: WorkingStorage | undefined, admit: (bytes: number) => void) {
  const tape = storage ? new ZipWriteChain(storage, 16384, context.signal, async signal => { signal.throwIfAborted(); }) : undefined;
  const buffer = tape ? new Uint8Array(16384) : undefined, fragments: string[] = [];
  let used = 0, hasContent = false;
  function dispose() { buffer?.fill(0); fragments.length = 0; }
  context.own(dispose);
  return {
    get hasContent() { return hasContent; },
    dispose,
    async append(fragment: string) {
      context.signal.throwIfAborted();
      if (!fragment) return;
      hasContent = true;
      if (!tape) { fragments.push(fragment); return; }
      for await (const bytes of encodeTextStream((async function* () { yield fragment; })(), "UTF-8", false, context)) {
        admit(bytes.length);
        for (let offset = 0; offset < bytes.length;) {
          const take = Math.min(buffer!.length - used, bytes.length - offset);
          buffer!.set(bytes.subarray(offset, offset + take), used); used += take; offset += take;
          if (used === buffer!.length) { await tape.append([buffer!], used); used = 0; }
        }
      }
    },
    async *render(): AsyncGenerator<string | Uint8Array> {
      context.signal.throwIfAborted();
      if (!tape) { yield* fragments; return; }
      if (used) { await tape.append([buffer!.subarray(0, used)], used); used = 0; }
      buffer!.fill(0);
      yield* tape.read();
    }
  };
}
