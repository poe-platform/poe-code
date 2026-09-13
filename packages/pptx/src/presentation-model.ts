import type { BinaryInput, ByteSink } from "./contracts.js";
import type { PptxPublicationRequest } from "./command-engine.js";
import { readBinary, writeBinary } from "./bytes.js";
import { createPresentation } from "./creation.js";
import { OfficeError, TypeError as ModelTypeError, ValueError } from "./errors.js";
import type { FontMetricsHandle } from "./font-metrics.js";
import { Length } from "./length.js";
import { attr, child, loadShared } from "./masters.js";
import { applyPresentationCanvasSettings } from "./presentation-settings.js";
import { CoreProperties, createPropertyPart } from "./properties.js";
import type { SelectionContext } from "./selectors.js";

export interface PresentationContext extends Partial<SelectionContext> {
  readonly timestamp?: Date;
  readonly author?: string;
  readonly fontMetrics?: FontMetricsHandle;
}

export interface PresentationPublication {
  readonly outputPath: string;
  readonly inPlace?: boolean;
  readonly force?: boolean;
  readonly publishOutput: (
    publication: PptxPublicationRequest,
    signal?: AbortSignal
  ) => Promise<void>;
}

function contextDefaults(context: PresentationContext): PresentationContext & SelectionContext {
  if (!context || typeof context !== "object") throw new ModelTypeError("Expected model context.");
  if (context.author !== undefined && typeof context.author !== "string")
    throw new ModelTypeError("Expected author text.");
  if (
    context.timestamp !== undefined &&
    (!(context.timestamp instanceof Date) || !Number.isFinite(context.timestamp.getTime()))
  )
    throw new ValueError("Expected a valid explicit timestamp.");
  return {
    ...context,
    author: context.author ?? "",
    ...(context.timestamp === undefined
      ? {}
      : { timestamp: new Date(context.timestamp.getTime()) }),
    limits: { ...(context.limits ?? { maxBytes: 16_777_216, maxReads: 8192, chunkBytes: 65536 }) },
    archiveLimits: {
      ...(context.archiveLimits ?? {
        maxArchiveBytes: 16_777_216,
        maxEntryBytes: 8_388_608,
        maxTotalBytes: 33_554_432,
        maxMembers: 4096,
        maxPathBytes: 1024,
        maxDepth: 32,
        maxPaxBytes: 4096,
        maxTextBytes: 8_388_608,
        chunkSize: 65536
      })
    },
    xmlLimits: {
      ...(context.xmlLimits ?? { maxBytes: 8_388_608, maxNodes: 100000, maxDepth: 128 })
    },
    relationshipLimits: {
      ...(context.relationshipLimits ?? {
        maxBytes: 8_388_608,
        maxParts: 4096,
        maxRelationships: 16384
      })
    }
  };
}

function cancelled(context: SelectionContext): void {
  if (context.signal?.aborted)
    throw new OfficeError("cancelled", "Operation cancelled.", "publish");
}

type State = Awaited<ReturnType<typeof loadShared>>;

export interface PresentationModel {
  readonly core_properties: CoreProperties;
  get slide_width(): Length | null;
  set slide_width(value: Length);
  get slide_height(): Length | null;
  set slide_height(value: Length);
  save(destination?: undefined): Promise<Uint8Array>;
  save(destination: ByteSink | PresentationPublication): Promise<void>;
}

class LivePresentation implements PresentationModel {
  #properties: CoreProperties | undefined;
  #propertyPart: string | undefined;
  #revision = 0;
  #publishedSource: Uint8Array;
  constructor(
    private readonly state: State,
    private readonly context: SelectionContext,
    private readonly inputPath?: string
  ) {
    this.#publishedSource = state.source;
    const parts = state.index.inventory.relationships.filter(
      (edge) =>
        edge.owner === "/" && edge.type.endsWith("/metadata/core-properties") && !edge.external
    );
    if (parts.length > 1)
      throw new OfficeError("ambiguous-selection", "Multiple core property parts.", "select");
    this.#propertyPart = parts[0]?.targetPart ?? undefined;
  }
  get core_properties(): CoreProperties {
    if (!this.#properties) {
      if (!this.#propertyPart) {
        this.#propertyPart = createPropertyPart(this.state, "core", this.context);
        this.#revision++;
      }
      const part = this.#propertyPart;
      this.#properties = new CoreProperties(
        () => this.state.doc(part),
        (doc) => {
          this.state.save(part, doc);
          this.#revision++;
        }
      );
    }
    return this.#properties;
  }
  #dimension(attribute: "cx" | "cy"): Length | null {
    const doc = this.state.doc(this.state.main);
    const size = child(doc.root, "sldSz");
    if (!size) return null;
    const raw = attr(size, attribute);
    if (raw === undefined || !raw.length || [...raw].some((c) => c < "0" || c > "9"))
      throw new OfficeError("invalid-opc", "Invalid slide dimension.", "parse");
    return new Length(Number(raw));
  }
  #setDimension(attribute: "cx" | "cy", value: Length): void {
    if (!(value instanceof Length)) throw new ModelTypeError("Slide dimensions require a Length.");
    if (value.emu < 914400 || value.emu > 51206400)
      throw new ValueError("Slide dimensions must be between 1 and 56 inches.");
    const doc = this.state.doc(this.state.main);
    const missing = !child(doc.root, "sldSz");
    const propertyEdge = this.state.index.inventory.relationships.find(
      (edge) => edge.owner === this.state.main && edge.type.endsWith("/presProps") && !edge.external
    );
    const updated = applyPresentationCanvasSettings(
      doc,
      {
        ...(missing ? { width: 9144000, height: 6858000 } : {}),
        [attribute === "cx" ? "width" : "height"]: value.emu
      },
      propertyEdge?.targetPart ? this.state.doc(propertyEdge.targetPart) : undefined
    );
    this.state.save(this.state.main, updated);
    this.#revision++;
  }
  get slide_width(): Length | null {
    return this.#dimension("cx");
  }
  set slide_width(value: Length) {
    this.#setDimension("cx", value);
  }
  get slide_height(): Length | null {
    return this.#dimension("cy");
  }
  set slide_height(value: Length) {
    this.#setDimension("cy", value);
  }
  async save(destination?: undefined): Promise<Uint8Array>;
  async save(destination: ByteSink | PresentationPublication): Promise<void>;
  async save(destination?: ByteSink | PresentationPublication): Promise<Uint8Array | void> {
    if (destination !== undefined && (!destination || typeof destination !== "object"))
      throw new ModelTypeError("Expected an explicit publication capability.");
    if (destination && "publishOutput" in destination) {
      if (
        typeof destination.publishOutput !== "function" ||
        typeof destination.outputPath !== "string" ||
        !destination.outputPath.length ||
        (destination.inPlace !== undefined && typeof destination.inPlace !== "boolean") ||
        (destination.force !== undefined && typeof destination.force !== "boolean") ||
        (destination.inPlace &&
          (!this.inputPath || destination.outputPath !== this.inputPath || destination.force)) ||
        (!destination.inPlace && this.inputPath === destination.outputPath)
      )
        throw new ValueError("Invalid explicit publication destination.");
      destination = {
        outputPath: destination.outputPath,
        inPlace: destination.inPlace ?? false,
        force: destination.force ?? false,
        publishOutput: destination.publishOutput.bind(destination)
      };
    } else if (
      destination &&
      (typeof destination.write !== "function" || typeof destination.close !== "function")
    ) {
      throw new ModelTypeError("Expected an explicit byte sink.");
    }
    cancelled(this.context);
    const revision = this.#revision;
    const { bytes } = await this.state.finish(this.state.main, []);
    cancelled(this.context);
    if (revision !== this.#revision)
      throw new OfficeError(
        "stale-selection",
        "Presentation changed during serialization.",
        "publish"
      );
    if (destination === undefined) return new Uint8Array(bytes);
    if ("publishOutput" in destination) {
      try {
        await destination.publishOutput(
          {
            ...(this.inputPath === undefined ? {} : { inputPath: this.inputPath }),
            outputPath: destination.outputPath,
            bytes: new Uint8Array(bytes),
            originalBytes: new Uint8Array(this.#publishedSource),
            inPlace: destination.inPlace ?? false,
            force: destination.force ?? false,
            dryRun: false
          },
          this.context.signal
        );
        if (destination.inPlace) this.#publishedSource = new Uint8Array(bytes);
      } catch (error) {
        cancelled(this.context);
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "stale-selection"
        )
          throw new OfficeError("stale-selection", "Publication source changed.", "publish");
        throw new OfficeError("io-failure", "Presentation publication failed.", "publish");
      }
      cancelled(this.context);
      return;
    }
    await writeBinary(bytes, destination, this.context);
  }
}

export async function Presentation(
  input?: BinaryInput | null,
  context: PresentationContext = {}
): Promise<PresentationModel> {
  const admittedContext = contextDefaults(context);
  const inputPath = input && typeof input === "object" && "path" in input ? input.path : undefined;
  const bytes =
    input === undefined || input === null
      ? await createPresentation(
          {
            width: 9144000,
            height: 6858000,
            ...(admittedContext.author === undefined ? {} : { author: admittedContext.author }),
            ...(admittedContext.timestamp === undefined
              ? {}
              : { timestamp: admittedContext.timestamp })
          },
          admittedContext
        )
      : await readBinary(input, admittedContext);
  const state = await loadShared(bytes, admittedContext);
  return new LivePresentation(state, admittedContext, inputPath);
}
