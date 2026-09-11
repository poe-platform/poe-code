import { FsError } from "../../contracts/errors.js";
import type { ErrnoCode } from "../../contracts/errors.js";

type Node = { type: "file"; mode: number }
  | { type: "symlink"; mode: number; target: string }
  | { type: "directory"; mode: number; entries: ReadonlyMap<string, Node> };

interface Position {
  readonly node: Node;
  readonly name: string;
  readonly parent?: Position;
}

interface Component {
  readonly name: string;
  readonly start: number;
}

function components(path: string, signal?: AbortSignal): Component[] {
  const result: Component[] = [];
  let start = 0;
  for (let offset = 0; offset <= path.length; offset++) {
    signal?.throwIfAborted();
    if (offset !== path.length && path.charCodeAt(offset) !== 47) continue;
    if (offset > start) result.push({ name: path.slice(start, offset), start });
    start = offset + 1;
  }
  return result;
}

export function resolveMissingTarget(root: Node, path: string, signal?: AbortSignal): string {
  const fail = (code: ErrnoCode, failedPath = path): never => {
    throw new FsError(code, { syscall: "realpath", path: failedPath });
  };
  const origin = components(path, signal);
  const initial: Position = { node: root, name: "" };
  let position = initial;
  let links = 0;
  let missing = origin.length;
  let missingLink = false;
  for (let index = 0; index <= origin.length; index++) {
    const token = origin[index];
    if (!token && path.length > 0 && !path.endsWith("/")) break;
    const before = position;
    const frames = [{ names: [token ?? { name: ".", start: path.length }], next: 0 }];
    let first = true;
    let originLink = false;
    let found = true;
    while (frames.length > 0) {
      signal?.throwIfAborted();
      const frame = frames.at(-1);
      if (!frame) break;
      const component = frame.names[frame.next++];
      if (!component) { frames.pop(); continue; }
      const current = position.node;
      if (current.type !== "directory") return fail("ENOTDIR");
      if (((current.mode >> 6) & 1) !== 1) return fail("EACCES");
      const name = component.name;
      if (name === ".") { first = false; continue; }
      if (name === "..") { position = position.parent ?? initial; first = false; continue; }
      if (new TextEncoder().encode(name).byteLength > 255) return fail("ENAMETOOLONG");
      const node = current.entries.get(name);
      if (!node) { found = false; break; }
      if (first) originLink = node.type === "symlink";
      first = false;
      if (node.type === "symlink") {
        if (++links > 40) return fail("ELOOP");
        const names = components(node.target, signal);
        if (node.target.endsWith("/")) names.push({ name: ".", start: node.target.length });
        if (node.target.startsWith("/")) position = initial;
        frames.push({ names, next: 0 });
      } else position = { node, name, parent: position };
    }
    if (!found) {
      position = before;
      missing = index;
      missingLink = originLink;
      break;
    }
  }
  if (missingLink) {
    let end = path.length;
    for (let count = origin.length; count > missing; count--) {
      signal?.throwIfAborted();
      if (count === missing + 1 && path[end - 1] !== "/") return fail("ENOENT", path.slice(0, end));
      const last = origin[count - 1];
      if (!last) break;
      const boundary = last.start - 1;
      end = boundary <= 0 ? 1 : boundary === 1 && path.startsWith("/") ? 2 : boundary;
    }
  }
  const names: string[] = [];
  for (let current: Position | undefined = position; current?.parent; current = current.parent) {
    signal?.throwIfAborted();
    names.push(current.name);
  }
  names.reverse();
  for (let index = missing; index < origin.length; index++) {
    signal?.throwIfAborted();
    const name = origin[index]?.name;
    if (name === "..") names.pop();
    else if (name && name !== ".") names.push(name);
  }
  return `/${names.join("/")}`;
}
