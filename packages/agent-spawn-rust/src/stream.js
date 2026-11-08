import { StringDecoder } from "node:string_decoder";
import { native } from "./native.js";
export async function* readLines(stream) {
  const lines = new native.NativeSpawnLines(),
    decoder = new StringDecoder("utf8");
  for await (const chunk of stream) {
    const text =
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array
          ? decoder.write(Buffer.from(chunk))
          : String(chunk);
    yield* lines.push(text);
  }
  yield* lines.push(decoder.end());
  const last = lines.end();
  if (last !== null) yield last;
}
export async function applyMiddlewares(middlewares, context) {
  const state = new native.NativeSpawnDispatch();
  const dispatch = async (position) => {
    if (!state.enter(position, middlewares.length)) return;
    const middleware = middlewares[position];
    native.spawnMiddlewareCallback(position, typeof middleware === "function");
    await middleware(context, () => dispatch(position + 1));
  };
  await dispatch(0);
}
