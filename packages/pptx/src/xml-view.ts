import { InvalidHandleError, ValueError } from "./errors.js";
import type { XmlAttribute, XmlElement, XmlName, XmlPart } from "./xml.js";

export interface XmlViewOwner {
  read(): XmlPart;
  commit(expected: XmlPart, next: XmlPart): void;
}

export interface XmlElementView {
  readonly tag: XmlName;
  readonly attrib: readonly XmlAttribute[];
  text: string | null;
  readonly children: readonly XmlElementView[];
  get(name: XmlName): string | null;
  set(name: XmlName, value: string | null): void;
  append(child: XmlElementView): void;
  insert(index: number, child: XmlElementView): void;
  remove(child: XmlElementView): void;
  replace(old_child: XmlElementView, new_child: XmlElementView): void;
}
interface State {
  readonly owner: XmlViewOwner;
  document: XmlPart;
  element: XmlElement;
}
const states = new WeakMap<XmlElementView, State>();
function current(view: XmlElementView): State {
  const state = states.get(view);
  if (!state || state.owner.read() !== state.document) throw new InvalidHandleError();
  return state;
}
function pathTo(document: XmlPart, selected: XmlElement): number[] {
  const pending = [{ element: document.root, path: [] as number[] }];
  while (pending.length) {
    const { element, path } = pending.pop()!;
    if (element === selected) return path;
    for (let index = element.children.length - 1; index >= 0; index--)
      pending.push({ element: element.children[index]!, path: [...path, index] });
  }
  throw new InvalidHandleError();
}
function atPath(document: XmlPart, path: readonly number[]): XmlElement {
  let element = document.root;
  for (const index of path) {
    const child = element.children[index];
    if (!child) throw new InvalidHandleError();
    element = child;
  }
  return element;
}
function publish(state: State, next: XmlPart, path: readonly number[]): void {
  const element = atPath(next, path);
  state.owner.commit(state.document, next);
  state.document = state.owner.read();
  state.element = state.document === next ? element : atPath(state.document, path);
}
function ownedChild(parent: State, child: XmlElementView): State {
  const state = current(child);
  if (state.owner !== parent.owner || state.document !== parent.document)
    throw new ValueError("XML child must belong to the same part.");
  return state;
}
function move(parent: State, child: XmlElementView, index: number, replace: boolean): void {
  const source = ownedChild(parent, child);
  const sourcePath = pathTo(parent.document, source.element);
  const parentPath = pathTo(parent.document, parent.element);
  if (sourcePath.every((step, depth) => parentPath[depth] === step))
    throw new ValueError("XML move would create a cycle.");
  const sourceParentPath = sourcePath.slice(0, -1);
  const sourceIndex = sourcePath.at(-1)!;
  const sameParent =
    sourceParentPath.length === parentPath.length &&
    sourceParentPath.every((step, depth) => parentPath[depth] === step);
  if (sameParent && sourceIndex === index) return;
  const markup = parent.document.markup(source.element, true);
  let next = parent.document.spliceChildren(
    atPath(parent.document, sourceParentPath),
    sourceIndex,
    1,
    []
  );
  if (sameParent && sourceIndex < index) index--;
  else if (
    sourceParentPath.length < parentPath.length &&
    sourceParentPath.every((step, depth) => parentPath[depth] === step) &&
    parentPath[sourceParentPath.length]! > sourceIndex
  )
    parentPath[sourceParentPath.length]!--;
  next = next.spliceChildren(atPath(next, parentPath), index, replace ? 1 : 0, [markup]);
  publish(parent, next, parentPath);
}

export function createXmlElementView(owner: XmlViewOwner, element?: XmlElement): XmlElementView {
  const document = owner.read();
  const selected = element ?? document.root;
  pathTo(document, selected);
  const view: XmlElementView = {
    get tag() {
      return current(view).element.name;
    },
    get attrib() {
      return current(view).element.attributes;
    },
    get text() {
      const state = current(view);
      return state.document.text(state.element);
    },
    set text(value: string | null) {
      const state = current(view);
      if (value !== null && typeof value !== "string")
        throw new ValueError("Expected XML text or null.");
      publish(
        state,
        state.document.setText(state.element, value ?? ""),
        pathTo(state.document, state.element)
      );
    },
    get children() {
      const state = current(view);
      return Object.freeze(
        state.element.children.map((child) => createXmlElementView(owner, child))
      );
    },
    get(name: XmlName) {
      const state = current(view);
      if (!name || typeof name.namespace !== "string" || typeof name.localName !== "string")
        throw new ValueError("Expected a qualified XML name.");
      return (
        state.element.attributes.find(
          (attribute) =>
            attribute.name.namespace === name.namespace &&
            attribute.name.localName === name.localName
        )?.value ?? null
      );
    },
    set(name: XmlName, value: string | null) {
      const state = current(view);
      if (!name || typeof name.namespace !== "string" || typeof name.localName !== "string")
        throw new ValueError("Expected a qualified XML name.");
      publish(
        state,
        state.document.merge(state.element, { attributes: [{ ...name, value }] }),
        pathTo(state.document, state.element)
      );
    },
    append(child: XmlElementView) {
      const state = current(view);
      move(state, child, state.element.children.length, false);
    },
    insert(index: number, child: XmlElementView) {
      const state = current(view);
      if (!Number.isSafeInteger(index) || index < 0 || index > state.element.children.length)
        throw new ValueError("Invalid XML child index.");
      move(state, child, index, false);
    },
    remove(child: XmlElementView) {
      const state = current(view);
      const selected = ownedChild(state, child);
      const index = state.element.children.indexOf(selected.element);
      if (index < 0) throw new ValueError("XML element is not a direct child.");
      publish(
        state,
        state.document.spliceChildren(state.element, index, 1, []),
        pathTo(state.document, state.element)
      );
    },
    replace(old_child: XmlElementView, new_child: XmlElementView) {
      const state = current(view);
      const previous = ownedChild(state, old_child);
      const index = state.element.children.indexOf(previous.element);
      if (index < 0) throw new ValueError("XML element is not a direct child.");
      move(state, new_child, index, true);
    }
  };
  states.set(view, { owner, document, element: selected });
  return Object.freeze(view);
}
