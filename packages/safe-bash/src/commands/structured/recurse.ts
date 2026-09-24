import { truth, type Json } from "./limits.js";
import type { Interpreter } from "./interpreter.js";
import type { Ast } from "./parser.js";

/** Keep child streams suspended so traversal is lazy and depth first. */
export async function* recurse(scope: Interpreter, args: readonly Ast[], input: Json): AsyncGenerator<Json> {
  const update: Ast = args[0] ?? { kind: "optional", operand: { kind: "iterate", base: { kind: "identity" } } };
  async function* children(value: Json): AsyncGenerator<Json> {
    for await (const child of scope.run(update, value)) {
      if (args[1]) {
        for await (const condition of scope.run(args[1], child)) if (truth(condition)) yield child;
      } else yield child;
    }
  }
  const stack: AsyncGenerator<Json>[] = [];
  try {
    yield input;
    stack.push(children(input));
    while (stack.length) {
      await scope.budget.tick();
      const next = await stack[stack.length - 1]!.next();
      if (next.done) stack.pop();
      else {
        yield next.value;
        scope.budget.collection(stack.length + 1);
        stack.push(children(next.value));
      }
    }
  } finally {
    for (const iterator of stack.reverse()) await iterator.return(undefined);
  }
}
