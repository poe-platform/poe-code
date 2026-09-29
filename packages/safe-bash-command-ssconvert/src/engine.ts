import { createEngine as createSpreadsheetEngine } from "@poe-code/spreadsheet-engine";
import type { Engine, EngineOptions } from "./contracts.js";
import { sourceProviders } from "./codecs/providers.generated.js";
import { snapshotFormats } from "./codecs/format-provider.js";
import { createRegistry } from "./codecs/registry.js";
import { serializeClipboard } from "./conversion/clipboard.js";
import { createImageRendering } from "./rendering/images/index.js";

export { defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";

/** Compatibility composition: native format defaults and optional rendering services. */
export function createEngine(supplied: EngineOptions = {}): Engine {
  const formats = snapshotFormats(supplied.formats ?? sourceProviders);
  const codecs = supplied.codecs ?? [];
  const registry = createRegistry(codecs, formats);
  return createSpreadsheetEngine({ ...supplied, formats, codecs,
    rendering: supplied.rendering ?? createImageRendering(),
    clipboard: supplied.clipboard ?? {
      serialize(book, target, range, context) {
        return serializeClipboard(book, target, range, context, id => registry.select("write", id));
      }
    }
  });
}
