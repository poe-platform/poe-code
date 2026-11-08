/** The parser's host-supplied work and allocation accounting contract. */
export interface AdapterContext {
  readonly sinceYield?: number | undefined;
  checkpoint(units?: number): void;
  charge(key: "text" | "retainedBytes" | "nodes" | "references" | "tableCells" | "entities" | "entityBytes", units: number): void;
  bound(key: "depth" | "text" | "references", actual: number): void;
  cooperate(units?: number): Promise<void>;
  decodeEntity(code: number): string;
  resourceTarget?(target: object, line: number, origin?: { readonly base?: string; readonly source?: string }): void;
  linkReference?(target: object, label: string, style: "full" | "collapsed" | "shortcut"): void;
  autolink?(target: object, label: string, style: "bracketed" | "bare"): void;
  footnoteReference?(label: string): boolean;
}
