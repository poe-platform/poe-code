export * from "safe-bash-presentation-engine";
import { resourceContext } from "safe-bash-presentation-engine/resource-limits";
import type {
  PptxCommandEngine,
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxCommandOutput,
  PptxPublicationRequest
} from "./command-engine.js";
export type {
  PptxCommandEngine,
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxCommandOutput,
  PptxPublicationRequest
};
let cachedPptxEngineMod: Promise<typeof import("./command-engine.js")> | undefined;
export function createPptxCommandEngine(settings: PptxCommandEngineOptions = {}): PptxCommandEngine {
  const context = resourceContext(settings.context);
  const maxArgumentBytes = settings.maxArgumentBytes ?? Infinity;
  const maxOutputBytes = settings.maxOutputBytes ?? Infinity;
  if (
    !context ||
    ![maxArgumentBytes, maxOutputBytes, context.limits?.maxBytes].every(
      (value) => (value === Infinity || Number.isSafeInteger(value)) && value > 0
    )
  ) {
    throw new TypeError("Pptx limits must be positive safe integers or unlimited.");
  }
  const ownedSettings: PptxCommandEngineOptions = {
    maxArgumentBytes,
    maxOutputBytes,
    context: {
      ...context,
      limits: { ...context.limits },
      archiveLimits: { ...context.archiveLimits },
      xmlLimits: { ...context.xmlLimits },
      relationshipLimits: { ...context.relationshipLimits },
      ...(settings.context?.validationLimits
        ? { validationLimits: { ...settings.context.validationLimits } }
        : {})
    }
  };
  return Object.freeze({
    async execute(request: PptxCommandRequest): Promise<PptxCommandOutput> {
      const mod = await (cachedPptxEngineMod ??= import("./command-engine.js"));
      return mod.createPptxCommandEngine(ownedSettings).execute(request);
    }
  });
}
