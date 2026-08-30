export type EreResource =
  | "patternBytes"
  | "subjectBytes"
  | "work"
  | "states"
  | "allocationUnits"
  | "captureBytes"
  | "captureSlots";

export type EreLimits = Readonly<Record<EreResource, number>>;
export type EreUsage = Readonly<Record<EreResource, number>>;

export interface EreExpansionBounds {
  readonly maxExpansionBytes: number;
  readonly maxExpansionFields: number;
}

export interface EreFragment {
  readonly text: string;
  readonly literal: boolean;
}

export interface EreSpan {
  readonly start: number;
  readonly end: number;
}

export interface EreMatch {
  readonly matched: true;
  readonly captures: readonly (EreSpan | null)[];
  readonly values: readonly string[];
}

export interface EreNoMatch {
  readonly matched: false;
  readonly captures: readonly [];
  readonly values: readonly [];
}

export type EreResult = EreMatch | EreNoMatch;

export interface EreProgram {
  readonly pattern: string;
  readonly groups: number;
}

export interface EreNodeBase {
  readonly nullable: boolean;
  readonly captured: boolean;
}

export type EreNode = EreNodeBase & (
  | { readonly kind: "empty" | "dot" | "start" | "end" }
  | { readonly kind: "literal"; readonly code: number }
  | { readonly kind: "set"; readonly members: readonly boolean[] }
  | { readonly kind: "sequence" | "alternative"; readonly children: readonly EreNode[] }
  | { readonly kind: "group"; readonly index: number; readonly child: EreNode }
  | { readonly kind: "repeat"; readonly child: EreNode; readonly min: number; readonly max: number }
);
