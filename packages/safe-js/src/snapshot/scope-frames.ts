import type { Budget } from "../interp/budget.js";
import { assertSnapshotDataDepth } from "../graph-depth.js";
import { Scope } from "../interp/scope.js";
import type { SandboxObject, SandboxValue } from "../interp/values.js";
import type { PrivateName } from "../interp/private-state.js";
import type { ResourceScopeState } from "../interp/resource-management.js";
import type { GuestHeapNode } from "./guest-heap.js";

type Frame = Extract<GuestHeapNode<unknown>, { kind: "scope-frame" }>;

function parentId(frame: Frame): number | undefined {
  const parent = frame.parent as { kind?: string; id?: unknown } | null;
  if (parent?.kind === "undefined") return undefined;
  if (parent?.kind !== "ref" || typeof parent.id !== "number" || !Number.isSafeInteger(parent.id) || parent.id < 1)
    throw new TypeError("Invalid scope parent reference.");
  return parent.id;
}

export function allocateGuestScopes(frames: ReadonlyMap<number, Frame>, budget: Budget): Map<number, Scope> {
  const scopes = new Map<number, Scope>();
  const depths = new Map<number, number>();
  for (const id of frames.keys()) {
    const path: number[] = [];
    const active = new Set<number>();
    let current: number | undefined = id;
    while (current !== undefined && !scopes.has(current)) {
      if (active.has(current)) throw new TypeError("Cyclic scope parent graph.");
      const frame = frames.get(current);
      if (frame === undefined) throw new TypeError(`Missing scope frame ${current}.`);
      budget.visitNode();
      active.add(current);
      path.push(current);
      assertSnapshotDataDepth(path.length - 1, "<scope-parent>");
      current = parentId(frame);
    }
    for (let index = path.length - 1; index >= 0; index--) {
      const frameId = path[index];
      const frame = frames.get(frameId)!;
      const parent = parentId(frame);
      const depth = parent === undefined ? 0 : depths.get(parent)! + 1;
      assertSnapshotDataDepth(depth, "<scope-parent>");
      depths.set(frameId, depth);
      scopes.set(frameId, new Scope({}, parent === undefined ? undefined : scopes.get(parent), undefined, {
        functionBoundary: frame.functionBoundary, chargeData: frame.chargeData, globalEnvironment: frame.globalEnvironment,
        simpleCatchParameter: frame.simpleCatchParameter
      }));
    }
  }
  return scopes;
}

// Decode only after scope/function identities exist in the enclosing heap map.
// The caller validates the wire format first and meters decoded guest values.
export function hydrateGuestScopes(
  frames: ReadonlyMap<number, Frame>,
  scopes: ReadonlyMap<number, Scope>,
  decode: (value: unknown) => SandboxValue,
  budget: Budget
): void {
  for (const [id, frame] of frames) {
    budget.visitNode(1 + frame.bindings.length + frame.cells.length);
    const scope = scopes.get(id);
    if (scope === undefined) throw new TypeError(`Missing allocated scope ${id}.`);
    const parent = parentId(frame);
    if (parent !== undefined && !scopes.has(parent)) throw new TypeError(`Missing allocated parent ${parent}.`);
    const resourceState = frame.resourceState === undefined ? undefined : decode(frame.resourceState);
    scope.hydrateFrame({
      parent: parent === undefined ? undefined : scopes.get(parent),
      importMeta: decode(frame.importMeta),
      functionBoundary: frame.functionBoundary,
      simpleCatchParameter: frame.simpleCatchParameter,
      globalEnvironment: frame.globalEnvironment,
      chargeData: frame.chargeData,
      bindings: frame.bindings,
      ...(frame.moduleEnvironment === undefined ? {} : {moduleEnvironment: {
        available: [...frame.moduleEnvironment.available],
        namespaces: decode(frame.moduleEnvironment.namespaces) as Record<string,SandboxValue>
      }}),
      ...(frame.objectEnvironment === undefined ? {} : {objectEnvironment: decode(frame.objectEnvironment) as SandboxObject}),
      ...(frame.withObject === undefined ? {} : {withObject: decode(frame.withObject) as SandboxObject}),
      ...(resourceState === undefined ? {} : {resourceState: resourceState as ResourceScopeState}),
      ...(frame.privateNames === undefined ? {} : { privateNames: frame.privateNames.map(([name, identity]) => [name, decode(identity) as PrivateName] as [string, PrivateName]) }),
      cells: frame.cells.map(cell => cell.initialized ? { ...cell, value: decode(cell.value) } : cell),
      ...(frame.restoredBindings === undefined ? {} : {
        restoredBindings: frame.restoredBindings.map(([name, value]) => [name, decode(value)] as [string, SandboxValue])
      })
    });
  }
}
