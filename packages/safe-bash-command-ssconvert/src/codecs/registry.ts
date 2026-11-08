import { createRegistry as createFormatRegistry } from "@poe-code/spreadsheet-engine";
import { sourceProviders } from "./providers.generated.js";
import type { Codec, FormatProvider, SourceService } from "./types.js";

/** Complete native source census, independent of a consumer's installed formats. */
export const sourceServices: readonly SourceService[] = Object.freeze(
  createFormatRegistry([], sourceProviders).coverage().map(({ installed: _installed, ...service }) => Object.freeze(service))
);

export function createRegistry(codecs: readonly Codec[], formats: readonly FormatProvider[] = sourceProviders) {
  const registry = createFormatRegistry(codecs, formats);
  const installed = new Set(registry.coverage().filter(service => service.installed)
    .map(service => `${service.direction}:${service.id}`));
  return { ...registry,
    coverage() {
      return Object.freeze(sourceServices.map(service => Object.freeze({ ...service,
        installed: installed.has(`${service.direction}:${service.id}`)
      })));
    }
  };
}
