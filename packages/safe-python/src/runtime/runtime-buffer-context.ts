import type { ImmutableBytes } from "./immutable-bytes.js";
import type { RuntimeValue } from "./runtime-values.js";

/** A successful PyBUF_SIMPLE-style acquisition pins contiguous byte storage.
 * The provider rejects non-contiguous exports and meters acquisition/copies.
 * Length stays fixed until release. Copy is guest-code-free and observes current
 * bytes, including mutations by later guest callbacks.
 * Release is mandatory, non-throwing host cleanup even after cancellation; any
 * guest release-hook errors belong to the provider's unraisable-error policy. */
export interface RuntimeBufferLease {
  readonly byteLength: number;
  copy(): ImmutableBytes;
  release(): void;
}

export interface RuntimeBufferContext {
  /** Undefined means no buffer protocol; exporter errors propagate unchanged. */
  acquireSimple(value: RuntimeValue): RuntimeBufferLease | undefined;
}
