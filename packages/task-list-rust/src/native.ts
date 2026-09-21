import { createRequire } from "node:module";
export const native = createRequire(import.meta.url)("./task-list-rust.node") as {
  taskCanFire(from: readonly string[] | null, to: string, state: string): boolean;
  taskVisibleName(value: string): boolean;
  taskPrintableIdentifier(value: string): boolean;
  taskValidId(value: string): boolean;
};
