import type { Location } from "./location-token.js";

export interface ControlTemplateData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "replace"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
