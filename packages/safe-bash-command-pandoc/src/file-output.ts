import {createBytePipe} from "safe-bash-contracts";
import type {FileSystem, ConditionalFilePublicationOptions} from "@poe-code/safe-fs/core";
import {PandocError} from "./errors.js";
import type {StreamingOutputCapability} from "./types.js";

/** Bridge a conversion sink to the caller's atomic streaming publisher. The
 * provider privately consumes the bounded pipe and commits only at EOF. */
export function createFileOutput(fs: FileSystem, path: string, options: ConditionalFilePublicationOptions): StreamingOutputCapability {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let pipe: ReturnType<typeof createBytePipe> | undefined;
  let publication: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let aborting: Promise<void> | undefined;
  let writing = false;
  let closed = false;
  let committed = false;
  const start = () => {
    pipe ??= createBytePipe({highWaterMark: 16384, signal});
    publication ??= (async () => {
      signal.throwIfAborted();
      const capabilities = await fs.capabilitiesFor?.(path, {signal}) ?? fs.capabilities;
      if (!capabilities.atomicFilePublication || !fs.publishFileConditional || capabilities.readOnly || capabilities.write === false)
        throw new PandocError("E_CAPABILITY", "convert", "Output requires atomic streaming file publication");
      let consumed = false;
      const source = (async function* () {
        for await (const bytes of pipe!.readable) yield bytes;
        consumed = true;
      })();
      await fs.publishFileConditional(path, source, {...options, signal});
      if (!consumed) throw new PandocError("E_IO", "convert", "File publisher returned before consuming output");
      committed = true;
    })().catch(async reason => {await pipe?.abort(reason); throw reason;});
    // The first write may still be waiting for its consumer when publication fails.
    void publication.catch(() => {});
    return publication;
  };
  return {
    async write(bytes, suppliedSignal) {
      suppliedSignal?.throwIfAborted();
      signal.throwIfAborted();
      if (closed || writing) throw new PandocError("E_IO", "convert", "File output is closed or a write is pending");
      writing = true;
      start();
      try {await pipe!.writable.write(bytes);}
      catch (reason) {await publication; throw reason;}
      finally {writing = false;}
    },
    close(suppliedSignal) {
      suppliedSignal?.throwIfAborted();
      if (aborting) return Promise.reject(new PandocError("E_IO", "convert", "File output was aborted"));
      if (writing) return Promise.reject(new PandocError("E_IO", "convert", "File output write is pending"));
      closed = true;
      closing ??= (async () => {start(); await pipe!.close(); await publication;})();
      return closing;
    },
    abort(reason) {
      if (committed) return Promise.resolve();
      closed = true;
      aborting ??= (async () => {
        controller.abort(reason);
        await pipe?.abort(reason);
        await publication?.catch(() => {});
      })();
      return aborting;
    }
  };
}
