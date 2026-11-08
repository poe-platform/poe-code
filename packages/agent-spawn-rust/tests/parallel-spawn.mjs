// Reference thunk tests exercise the independent combinator, not production spawn wiring.
import { createSpawnParallel } from "../dist/parallel.js";
export const spawn = {
  parallel: createSpawnParallel(() => {
    throw Error("Tuple execution requires an injected spawn function.");
  })
};
