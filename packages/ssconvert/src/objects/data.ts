/** Released graph.c and go-data-simple.c serializers have different grammars. */
export const chartDataTypes: Readonly<Record<string, { readonly storage: "expression" | "literal"; readonly dimensions: 0 | 1 | 2 }>> = Object.freeze(Object.fromEntries(Object.entries({
  GnmGODataScalar: { storage: "expression", dimensions: 0 },
  GnmGODataVector: { storage: "expression", dimensions: 1 },
  GnmGODataMatrix: { storage: "expression", dimensions: 2 },
  GODataScalarVal: { storage: "literal", dimensions: 0 },
  GODataScalarStr: { storage: "literal", dimensions: 0 },
  GODataVectorVal: { storage: "literal", dimensions: 1 },
  GODataVectorStr: { storage: "literal", dimensions: 1 },
  GODataMatrixVal: { storage: "literal", dimensions: 2 }
} satisfies Record<string, { readonly storage: "expression" | "literal"; readonly dimensions: 0 | 1 | 2 }>).map(([name, descriptor]) => [name, Object.freeze(descriptor)])));

export interface ChartData {
  readonly id: string;
  readonly type: string;
  readonly serialized: string;
  readonly storage: "expression" | "literal" | "unknown";
  readonly expression?: string;
}
