import type { FormatProvider } from "./types.js";

/** Capture explicit host composition before a bound command can be invoked. */
export function snapshotFormats(formats: readonly FormatProvider[]): readonly FormatProvider[] {
  return Object.freeze(formats.map(provider => Object.freeze({ ...provider,
    services: Object.freeze(provider.services.map(service => Object.freeze({ ...service,
      extensions: Object.freeze([...service.extensions]),
      ...(service.filenameSuffixes === undefined ? {} : { filenameSuffixes: Object.freeze([...service.filenameSuffixes]) }),
      ...(service.mimeTypes === undefined ? {} : { mimeTypes: Object.freeze([...service.mimeTypes]) }),
      ...(service.exporterOptionKeys === undefined ? {} : { exporterOptionKeys: Object.freeze([...service.exporterOptionKeys]) }),
      ...(service.exportOptionRules === undefined ? {} : { exportOptionRules: Object.freeze(Object.fromEntries(
        Object.entries(service.exportOptionRules).map(([key, rule]) => [key, Object.freeze({ ...rule,
          ...(rule.kind === "enum" ? { values: Object.freeze([...rule.values]) } : {}) })])
      )) })
    })))
  })));
}
