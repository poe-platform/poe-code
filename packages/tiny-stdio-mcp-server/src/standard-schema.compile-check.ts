import { S, type StandardSchema } from "toolcraft-schema";
import { createServer, defineSchema } from "./index.js";

const server = createServer({ name: "inference", version: "1" });
const schema = S.Object({ count: S.Optional(S.Number({ default: 10 })) });
server.tool("count", "Count", schema, ({ count }) => {
  const result: number = count;
  // @ts-expect-error The default produces a number, not a string.
  const ignoredWrong: string = count;
  return { count: result };
}, S.Object({ count: S.Number() }));
server.registerTool({ name: "registered", inputSchema: schema }, ({ count }) => String(count + 1));

declare const transformed: StandardSchema<{ count: string }, { count: number }>;
server.tool("transform", "Transform", transformed, ({ count }) => count.toFixed());
server.tool("output", "Output", defineSchema({}), () => ({ count: "1" }), transformed);
// @ts-expect-error The output parser requires a string before transformation.
server.tool("invalid", "Invalid", defineSchema({}), () => ({ count: false }), transformed);
