import { S } from "toolcraft-schema";

export function makeSchemaModule(): { S: typeof S } {
  return { S };
}
