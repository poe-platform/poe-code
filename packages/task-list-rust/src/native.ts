import { createRequire } from "node:module";
export const native = createRequire(import.meta.url)("./task-list-rust.node") as {
  taskGhIssueNumber(id: string): number | null;
  taskGhRepo(repo: string): { owner: string; name: string } | null;
  taskGhJson(source: string): unknown;
  taskSplitDocument(
    content: string,
    passthrough: boolean
  ): { frontmatter: string; body: string } | null;
  taskActiveFilename(filename: string): { id: string; order: number | null } | null;
  configYamlParse(
    content: string,
    dateKey: (epoch: number) => string,
    uniqueKeys: boolean,
    objectRoot: boolean
  ): {
    value: unknown;
    error?: { message: string };
    temporals: [string[], number | "symbol", string][];
    dateIds: number[];
    symbolIds: number[];
  };
  configYamlSerialize(snapshot: Buffer): string;
  taskCanFire(from: readonly string[] | null, to: string, state: string): boolean;
  taskVisibleName(value: string): boolean;
  taskPrintableIdentifier(value: string): boolean;
  taskValidId(value: string): boolean;
};
