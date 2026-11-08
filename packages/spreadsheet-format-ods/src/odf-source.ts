import { createAxisStorage } from "@poe-code/spreadsheet-engine/workbook/axis-storage";
import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { WorkbookSource } from "@poe-code/spreadsheet-engine/codecs/types";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { ZipStorageFailure } from "@poe-code/office-package";
import { createOdfCellStorage } from "./odf-cell-storage.js";

// Keep replay closures outside the XML reader so they cannot retain its parser,
// recognized trees, style lookup tables or formula preparation environments.
export function createOdfSource(context: CapabilityContext) {
  let storedCells: ReturnType<typeof createOdfCellStorage> | undefined = undefined;
  let storedAxes: ReturnType<typeof createAxisStorage> | undefined = undefined;
  type Axis = ReturnType<ReturnType<typeof createAxisStorage>["axis"]>;
  const sources = new Map<string, { ordinal: number; rows: Axis; columns: Axis }>();
  let closed = false;
  let storage: import("@poe-code/spreadsheet-engine/contracts").WorkingStorage | undefined;
  let closing: Promise<void> | undefined;
  context.own(() => {
    closed = true;
    return closing ??= Promise.resolve().then(async () => {
      await storedCells?.close(); await storedAxes?.close(); await storage?.close();
    });
  });
  if (closed) throw new SsconvertError("invalid-request", "ODF source is closed");
  try { storage = context.createWorkingStorage!(); } catch (error) { throw new ZipStorageFailure(error); }
  if (closed) throw new SsconvertError("invalid-request", "ODF source is closed");
  const backing = storage;
  let pending: Promise<unknown> = Promise.resolve();
  function transfer<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action);
    pending = result.then(() => undefined, () => undefined);
    return result;
  }
  const wrapped: typeof backing = {
    allocate(length) { try { return backing.allocate(length); } catch (error) { throw new ZipStorageFailure(error); } },
    read(position, length) { return transfer(async () => {
      try { return new Uint8Array(await backing.read(position, length)); } catch (error) { throw new ZipStorageFailure(error); }
    }); },
    write(position, bytes) { return transfer(async () => {
      try { await backing.write(position, bytes); } catch (error) { throw new ZipStorageFailure(error); }
    }); },
    close: () => backing.close()
  };
  storedCells = createOdfCellStorage(wrapped, context.signal);
  storedAxes = createAxisStorage(wrapped, context.signal);
  return { cells: storedCells!, axes: storedAxes!, sheets: sources,
    workbook(metadata: Workbook): WorkbookSource {
      const cellStore = storedCells!;
      const get = (id: string) => {
        context.signal.throwIfAborted();
        if (closed) throw new SsconvertError("invalid-request", "ODF source is closed");
        const source = sources.get(id);
        if (!source) throw new SsconvertError("invalid-request", "Unknown ODF source sheet");
        return source;
      };
      function failure(error: unknown): never {
        context.signal.throwIfAborted();
        if (error instanceof ZipStorageFailure) throw error.cause;
        throw error;
      }
      return { metadata,
        async *cells(id) { try { yield* cellStore.cells(get(id).ordinal); } catch (error) { return failure(error); } },
        async *axes(id, kind) { try { yield* get(id)[kind].values(); } catch (error) { return failure(error); } }
      };
    }
  };
}
