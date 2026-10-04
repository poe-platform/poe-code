import type {BackedJson} from "./backed-json.js";
import type {ExecutionContext} from "./execution.js";
import {localResourceTarget} from "./resources.js";

function suffixStart(chunk: string): number {
  const query = chunk.indexOf("?"), fragment = chunk.indexOf("#");
  return query < 0 ? fragment : fragment < 0 ? query : Math.min(query, fragment);
}

// Only filesystem paths cross the host's string boundary. The completed tree
// records the UTF-16 extent, so path admission need not reread a long suffix.
export async function retainedLocalResourceTarget(tree: BackedJson, node: number, context: ExecutionContext): Promise<{name: string; suffixUnits: number}> {
  let path = "";
  for await (const chunk of tree.scalarChunks(node)) {
    const start = suffixStart(chunk);
    if (start < 0) path += chunk;
    else {
      path += chunk.slice(0, start);
      const units = ((await tree.describe(node)).end - node - 32) / 2;
      return {name: localResourceTarget(path, context).name, suffixUnits: units - path.length};
    }
  }
  return {name: localResourceTarget(path, context).name, suffixUnits: 0};
}

export async function* retainedResourceSuffix(tree: BackedJson, node: number) {
  let started = false;
  for await (const chunk of tree.scalarChunks(node)) {
    if (started) {yield chunk; continue;}
    const start = suffixStart(chunk);
    if (start >= 0) {started = true; yield chunk.slice(start);}
  }
}
