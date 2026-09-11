import { TsortError, fileQuote, raw } from "./internal.js";
import { Lifecycle, Reader } from "./io.js";

interface Edge { target: Node; next: Edge | undefined }
interface Node { name: string; count: number; printed: boolean; top: Edge | undefined; link: Node | undefined }

export async function sort(reader: Reader, lifecycle: Lifecycle): Promise<number> {
  const { budget } = lifecycle;
  const nodes = new Map<string, Node>();
  let tokens = 0, edges = 0, length = 0, nameLength = 0;
  let nul = false;
  let token: Uint8Array = new Uint8Array();
  let predecessor: Node | undefined;
  const admitToken = (): void => {
    budget.check(++tokens, budget.limits.maxTokens, "tokens");
    budget.charge(nameLength + 1);
    budget.retain(nameLength * 4);
    const name = raw(token.subarray(0, nameLength));
    let node = nodes.get(name);
    if (!node) {
      budget.check(nodes.size + 1, budget.limits.maxNodes, "nodes");
      budget.retain(160);
      node = { name, count: 0, printed: false, top: undefined, link: undefined };
      nodes.set(name, node);
    } else budget.retain(-nameLength * 4);
    if (!predecessor) predecessor = node;
    else {
      if (predecessor !== node) {
        budget.check(++edges, budget.limits.maxEdges, "edges");
        budget.retain(48);
        predecessor.top = { target: node, next: predecessor.top };
        node.count++;
      }
      predecessor = undefined;
    }
    length = 0;
    nameLength = 0;
    nul = false;
  };
  for (;;) {
    const value = await reader.get();
    if (value < 0 || value === 32 || value === 9 || value === 10) {
      if (length) admitToken();
      if (value < 0) break;
    } else {
      budget.check(++length, budget.limits.maxTokenBytes, "token bytes");
      if (value === 0) nul = true;
      if (!nul) {
        if (nameLength === token.length) {
          const capacity = Math.min(budget.limits.maxTokenBytes, Math.max(64, token.length * 2));
          budget.retain(capacity);
          budget.charge(token.length);
          const grown = new Uint8Array(capacity);
          grown.set(token);
          budget.retain(-token.length);
          token = grown;
        }
        token[nameLength++] = value;
      }
    }
  }
  budget.retain(-token.length);
  token = new Uint8Array();
  if (predecessor) throw new TsortError(`${fileQuote(reader.name)}: input contains an odd number of tokens`);
  budget.retain(nodes.size * 16);
  let ordered = [...nodes.values()];
  let scratch = new Array<Node>(ordered.length);
  for (let width = 1; width < ordered.length; width *= 2) {
    for (let start = 0; start < ordered.length; start += width * 2) {
      const middle = Math.min(start + width, ordered.length), end = Math.min(start + width * 2, ordered.length);
      let left = start, right = middle;
      for (let offset = start; offset < end; offset++) {
        budget.charge();
        let useLeft = right === end;
        if (left < middle && right < end) {
          budget.charge(Math.min(ordered[left]!.name.length, ordered[right]!.name.length) + 1);
          useLeft = ordered[left]!.name < ordered[right]!.name;
        }
        scratch[offset] = left < middle && useLeft ? ordered[left++]! : ordered[right++]!;
        await budget.checkpointWork();
      }
    }
    [ordered, scratch] = [scratch, ordered];
  }
  let remaining = ordered.length, status = 0;
  while (remaining) {
    let head: Node | undefined, tail: Node | undefined;
    for (const node of ordered) {
      budget.charge();
      if (!node.printed && !node.count) {
        if (tail) tail.link = node; else head = node;
        tail = node;
        node.link = undefined;
      }
      await budget.checkpointWork();
    }
    while (head) {
      const node: Node = head;
      budget.check(node.name.length + 1, budget.limits.maxOutputBytes, "output bytes");
      await lifecycle.write(`${node.name}\n`);
      node.printed = true;
      remaining--;
      for (let edge = node.top; edge; edge = edge.next) {
        budget.charge();
        if (!--edge.target.count) {
          tail!.link = edge.target;
          tail = edge.target;
          tail.link = undefined;
        }
        await budget.checkpointWork();
      }
      head = node.link;
      node.link = undefined;
    }
    if (!remaining) break;
    status = 1;
    await lifecycle.write(`tsort: ${fileQuote(reader.name)}: input contains a loop:\n`, true);
    let loop: Node | undefined;
    do {
      let found = false;
      for (const node of ordered) {
        budget.charge();
        await budget.checkpointWork();
        if (!node.count) continue;
        if (!loop) { loop = node; continue; }
        let previous: Edge | undefined;
        for (let edge = node.top; edge; edge = edge.next) {
          budget.charge();
          await budget.checkpointWork();
          if (edge.target === loop) {
            if (node.link) {
              while (loop) {
                budget.charge();
                const next: Node | undefined = loop.link;
                await lifecycle.write(`tsort: ${loop.name}\n`, true);
                if (loop === node) {
                  edge.target.count--;
                  if (previous) previous.next = edge.next; else node.top = edge.next;
                  break;
                }
                loop.link = undefined;
                loop = next;
              }
              while (loop) {
                budget.charge();
                const next: Node | undefined = loop.link;
                loop.link = undefined;
                loop = next;
                await budget.checkpointWork();
              }
              found = true;
            } else { node.link = loop; loop = node; }
            break;
          }
          previous = edge;
        }
        if (found) break;
      }
    } while (loop);
  }
  return status;
}
