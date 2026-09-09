import { Budget } from "../interp/budget.js";
import { sandboxErrorNames, type SandboxErrorName } from "../error/shape.js";
import { createRawJson } from "../interp/raw-json.js";
import { createSandboxLocale, localeTag } from "../interp/intl-locale.js";
import { createSandboxCollator, collatorState } from "../interp/intl-collator.js";
import { createSandboxListFormat, listFormatState } from "../interp/intl-listformat.js";
import { createSandboxRelativeTimeFormat, relativeTimeFormatState } from "../interp/intl-relativetimeformat.js";
import { createSandboxDisplayNames, displayNamesState } from "../interp/intl-displaynames.js";
import { createSandboxPluralRules, pluralRulesState, type ResolvedPluralRulesOptions } from "../interp/intl-pluralrules.js";
import { resolveDurationLocale } from "../interp/intl-duration-locale.js";
import { createSandboxSegmenter, createSandboxSegments, segmenterState, segmentState } from "../interp/intl-segmenter.js";
import { createSandboxNumberFormat, numberFormatState, type NumberFormatOptions } from "../interp/intl-numberformat.js";
import { createSandboxDateTimeFormat, dateTimeFormatState, type DateTimeFormatOptions } from "../interp/intl-datetimeformat.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { getIntrinsicIdentity, listIntrinsicIdentities, resolveIntrinsicIdentity } from "../interp/intrinsics.js";
import { releaseObjectPrototype } from "../interp/object-model.js";
import { isSandboxClosure } from "../interp/values.js";
import { assertSnapshotDataDepth } from "../graph-depth.js";
import { validateStringIteratorState } from "../interp/string-iterator.js";

let intrinsicKinds: Map<string, boolean> | undefined;

function intrinsicCatalogue(): Map<string, boolean> {
  if (intrinsicKinds !== undefined) return intrinsicKinds;
  const budget = new Budget();
  try {
    createBuiltinBindings({ budget });
    const kinds = new Map<string, boolean>();
    for (const id of listIntrinsicIdentities(budget)) {
      const value = resolveIntrinsicIdentity(budget, id);
      if (getIntrinsicIdentity(value) === id) kinds.set(id, isSandboxClosure(value));
    }
    intrinsicKinds = kinds;
    return kinds;
  } finally { releaseObjectPrototype(budget); }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a guest heap record.");
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Reflect.ownKeys(value).some(key =>
    typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
    !("value" in Object.getOwnPropertyDescriptor(value, key)!))) throw new TypeError("Invalid guest heap fields.");
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Expected a guest heap array.");
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid guest heap index.");
  return value;
}

function absent(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const node = record(value);
  return node.kind === "undefined" && Object.keys(node).length === 1;
}

export function validateGuestHeapNode(raw: unknown, heap: Record<string, unknown>, maxArrayLength = 0xffffffff): boolean {
  if (record(raw).kind === "guest-script") {
    const source = record(raw);
    fields(source, ["kind", "body", "context"]);
    if (typeof source.body !== "string") throw new TypeError("Invalid eval source.");
    const context = record(source.context);
    const flags = ["strict", "newTarget", "superProperty", "superCall", "arguments"];
    fields(context, [...flags, "privateNames"]);
    if (flags.some(name => typeof context[name] !== "boolean")) throw new TypeError("Invalid eval syntax context.");
    const names = array(context.privateNames);
    if (names.some(name => typeof name !== "string" || name.length === 0) || new Set(names).size !== names.length)
      throw new TypeError("Invalid eval private-name context.");
    return true;
  }
  if (record(raw).kind === "guest-source") {
    const source = record(raw);
    fields(source, ["kind", "functionKind", "parameters", "body"]);
    if (!["normal", "async", "generator", "async-generator"].includes(String(source.functionKind))
      || typeof source.parameters !== "string" || typeof source.body !== "string") throw new TypeError("Invalid dynamic source.");
    return true;
  }
  if (record(raw).kind === "mapped-arguments") {
    const node = record(raw);
    fields(node, ["kind", "scope", "parameters", "state", "nativeIterator"]);
    const scopeRef = record(node.scope);
    fields(scopeRef, ["kind", "id"]);
    if (scopeRef.kind !== "ref") throw new TypeError("Invalid mapped arguments scope.");
    const scope = record(heap[String(integer(scopeRef.id))]);
    if (scope.kind !== "scope-frame") throw new TypeError("Invalid mapped arguments scope.");
    if (typeof node.nativeIterator !== "boolean") throw new TypeError("Invalid native arguments iterator flag.");
    validateGuestHeapNode({kind: "guest-object", state: node.state}, heap, maxArrayLength);
    const properties = array(record(record(node.state).properties).properties).map(array);
    if (node.nativeIterator) {
      const iterator = properties.find(([key]) => typeof key === "object" && key !== null
        && record(heap[String(record(key).id)]).wellKnown === "iterator");
      if (iterator === undefined || record(iterator[1]).kind !== "data" || !absent(record(iterator[1]).value))
        throw new TypeError("Invalid native arguments iterator descriptor.");
    }
    const indices = new Set<string>(), names = new Set<string>();
    for (const rawParameter of array(node.parameters)) {
      const parameter = array(rawParameter);
      const [key, name] = parameter;
      if (parameter.length !== 2 || typeof key !== "string" || typeof name !== "string" || indices.has(key) || names.has(name)
        || !Number.isInteger(Number(key)) || Number(key) < 0 || Number(key) >= 0xffffffff || String(Number(key)) !== key)
        throw new TypeError("Invalid mapped argument parameter.");
      indices.add(key); names.add(name);
      const property = properties.find(entry => entry[0] === key);
      const descriptor = record(property?.[1]);
      if (descriptor.kind !== "data" || descriptor.writable !== true) throw new TypeError("Mapped argument must be writable.");
      const binding = array(scope.bindings).map(array).find(entry => entry[0] === name);
      const cell = binding === undefined ? undefined : record(array(scope.cells)[integer(binding[1])]);
      if (cell?.initialized !== true || cell.kind === "const") throw new TypeError("Missing mutable mapped parameter cell.");
    }
    return true;
  }
  const node = record(raw);
  if (node.kind === "module-namespace") {
    fields(node,["kind","entries"]);
    const entries = array(node.entries);
    if (entries.length > maxArrayLength) throw new TypeError("Module namespace exceeds allocation limit.");
    const names = new Set<string>();
    for (const rawEntry of entries) {
      const entry = array(rawEntry);
      if (entry.length !== 2 || typeof entry[0] !== "string" || names.has(entry[0]))
        throw new TypeError("Invalid module namespace export.");
      names.add(entry[0]);
    }
    return true;
  }
  if (node.kind === "raw-json") {
    fields(node, ["kind", "text"]);
    if (typeof node.text !== "string") throw new TypeError("Invalid raw JSON source.");
    createRawJson(node.text);
    return true;
  }
  if (node.kind !== "guest-proxy" && node.kind !== "guest-proxy-revoker" && !["guest-durationformat", "guest-segmenter", "guest-segments", "module-function", "async-generator-driver", "async-generator-handler", "async-function-driver", "async-function-handler", "thenable-state", "thenable-resolver", "construction-environment", "capability-executor", "promise-aggregate", "aggregate-entry", "aggregate-handler", "intrinsic", "bound-function", "promise-resolver", "pending-promise", "promise-reaction", "promise-adoption", "adoption-resolver", "guest-function", "guest-class", "guest-generator", "scope-frame", "guest-object", "guest-array", "guest-boxed", "guest-date", "guest-locale", "guest-listformat", "guest-pluralrules", "guest-displaynames", "guest-relativetimeformat", "guest-datetimeformat", "guest-numberformat", "guest-collator", "guest-regex", "guest-promise", "array-iterator", "string-iterator", "async-disposable-stack", "async-cleanup", "async-cleanup-handler", "disposable-stack", "iterator-wrapper", "iterator-helper", "guest-collection-iterator", "guest-regexp-iterator", "map", "set"].includes(String(node.kind))) return false;
  const reference = (value: unknown, kinds?: string[]) => {
    const ref = record(value);
    fields(ref, ["kind", "id"]);
    if (ref.kind !== "ref" || integer(ref.id) < 1 || !Object.hasOwn(heap, String(ref.id))) throw new TypeError("Invalid guest heap reference.");
    const target = record(heap[String(ref.id)]);
    if (kinds !== undefined && !kinds.includes(String(target.kind))) throw new TypeError("Wrong guest heap reference kind.");
    return target;
  };
  const callable = (value: unknown) => {
    if (absent(value)) return;
    const target = reference(value, ["guest-proxy", "guest-proxy-revoker", "module-function", "async-generator-handler", "async-function-handler", "async-cleanup-handler", "thenable-resolver", "aggregate-handler", "capability-executor", "intrinsic", "bound-function", "promise-resolver", "guest-function", "guest-class"]);
    if (target.kind === "guest-proxy" && target.callable !== true)
      throw new TypeError("Guest accessor Proxy is not callable.");
    if (target.kind === "intrinsic" && intrinsicCatalogue().get(String(target.id)) !== true)
      throw new TypeError("Guest accessor reference is not callable.");
  };
  if ((node.kind === "pending-promise" || node.kind === "guest-promise") && Object.hasOwn(node, "generatorOwner")) {
    const owner = reference(node.generatorOwner, ["async-generator-driver"]);
    if (!array(owner.requests).some(value => reference(record(record(value).capability).promise) === node))
      throw new TypeError("Invalid async generator request ownership.");
  }
  const privateIdentity = (value: unknown, expected?: string) => {
    const identity = reference(value, ["object"]);
    fields(identity, ["kind", "entries"]);
    const entries = record(identity.entries);
    fields(entries, ["description"]);
    if (typeof entries.description !== "string" || entries.description.length === 0 ||
        (expected !== undefined && entries.description !== expected)) throw new TypeError("Invalid private-name identity.");
  };
  const privateState = (value: unknown, methodsOnly = false) => {
    const names = new Set<number>();
    for (const raw of array(value)) {
      const element = record(raw);
      fields(element, element.kind === "accessor" ? ["name", "kind", "get", "set"] : ["name", "kind", "value"]);
      privateIdentity(element.name);
      const id = integer(record(element.name).id);
      if (names.has(id)) throw new TypeError("Duplicate private element.");
      names.add(id);
      if (element.kind === "accessor") { callable(element.get); callable(element.set); }
      else if (element.kind === "method") { if (absent(element.value)) throw new TypeError("Missing private method."); callable(element.value); }
      else if (element.kind !== "field" || methodsOnly) throw new TypeError("Invalid private element kind.");
    }
  };
  const state = (value: unknown) => {
    const object = record(value);
    fields(object, ["properties"], ["prototype", "privateElements"]);
    if (object.privateElements !== undefined) privateState(object.privateElements);
    if (Object.hasOwn(object, "prototype") && object.prototype !== null) reference(object.prototype);
    const properties = record(object.properties);
    fields(properties, ["properties", "extensible"]);
    if (typeof properties.extensible !== "boolean") throw new TypeError("Invalid guest extensibility.");
    const keys = new Set<string>();
    for (const rawEntry of array(properties.properties)) {
      const entry = array(rawEntry);
      if (entry.length !== 2) throw new TypeError("Invalid guest property entry.");
      let key: string;
      if (typeof entry[0] === "string") key = `string:${entry[0]}`;
      else {
        const symbol = reference(entry[0], ["symbol"]);
        key = symbol.wellKnown === undefined ? `symbol:${record(entry[0]).id}` : `well-known:${symbol.wellKnown}`;
      }
      if (keys.has(key)) throw new TypeError("Duplicate guest property key.");
      keys.add(key);
      const descriptor = record(entry[1]);
      if (descriptor.kind === "data") {
        fields(descriptor, ["kind", "value", "writable", "enumerable", "configurable"]);
        if (typeof descriptor.writable !== "boolean") throw new TypeError("Invalid guest writable flag.");
      } else if (descriptor.kind === "accessor") {
        fields(descriptor, ["kind", "get", "set", "enumerable", "configurable"]);
        callable(descriptor.get);
        callable(descriptor.set);
      } else throw new TypeError("Invalid guest descriptor kind.");
      if (typeof descriptor.enumerable !== "boolean" || typeof descriptor.configurable !== "boolean") throw new TypeError("Invalid guest descriptor flags.");
    }
  };
  if (Object.hasOwn(node, "producers")) {
    const producers = new Set<unknown>();
    for (const entry of array(node.producers)) {
      const producer = reference(entry, ["promise-reaction"]);
      const capabilityOwner = producer.capability === undefined ? undefined : reference(record(producer.capability).promise);
      const aggregateOwner = producer.aggregate === undefined ? undefined : reference(producer.aggregate);
      if (producers.has(producer) || (capabilityOwner !== node && aggregateOwner !== node))
        throw new TypeError("Invalid promise producer ownership.");
      producers.add(producer);
    }
  }
  if (node.kind === "map" || node.kind === "set") {
    fields(node, ["kind", node.kind === "map" ? "entries" : "values"], ["propertyState", "prototype", "privateElements"]);
    if (node.privateElements !== undefined) privateState(node.privateElements);
    state({ properties: Object.hasOwn(node, "propertyState") ? node.propertyState : { properties: [], extensible: true },
      ...(Object.hasOwn(node, "prototype") ? { prototype: node.prototype } : {}) });
    return false;
  }
  if (node.kind === "guest-proxy") {
    fields(node, ["kind", "target", "handler", "callable", "constructible"], ["privateElements"]);
    if (typeof node.callable !== "boolean" || typeof node.constructible !== "boolean" ||
        (node.constructible && !node.callable)) throw new TypeError("Invalid Proxy callable flags.");
    if ((node.target === null) !== (node.handler === null)) throw new TypeError("Invalid revoked Proxy state.");
    const objectKinds = ["object", "array", "map", "set", "float32array", "typedarray", "arraybuffer", "dataview",
      "boxed", "date", "regex-object", "module-namespace", "raw-json", "guest-proxy", "guest-proxy-revoker",
      "module-function", "async-generator-handler", "async-function-handler", "async-cleanup-handler", "thenable-resolver",
      "aggregate-handler", "adoption-resolver", "capability-executor", "intrinsic", "bound-function", "promise-resolver",
      "pending-promise", "promise-reaction", "guest-function", "guest-class", "guest-generator", "mapped-arguments",
      "guest-object", "guest-array", "guest-boxed", "guest-date", "guest-locale", "guest-listformat", "guest-pluralrules",
      "guest-displaynames", "guest-relativetimeformat", "guest-datetimeformat", "guest-numberformat", "guest-collator",
      "guest-durationformat", "guest-segmenter", "guest-segments", "guest-regex", "guest-promise", "guest-weakcollection",
      "array-iterator", "string-iterator", "async-disposable-stack", "disposable-stack", "iterator-wrapper", "iterator-helper",
      "guest-collection-iterator", "guest-regexp-iterator"];
    if (node.target !== null) {
      reference(node.handler, objectKinds);
      const seen = new Set([node]);
      let current = node;
      while (current.kind === "guest-proxy" && current.target !== null) {
        assertSnapshotDataDepth(seen.size, "Proxy target chain");
        const target = reference(current.target, objectKinds);
        if (seen.has(target)) throw new TypeError("Cyclic Proxy target chain.");
        seen.add(target);
        if (target.kind === "guest-proxy" &&
            (target.callable !== current.callable || target.constructible !== current.constructible))
          throw new TypeError("Inconsistent Proxy callable flags.");
        current = target;
      }
    }
    if (node.privateElements !== undefined) privateState(node.privateElements);
  } else if (node.kind === "guest-proxy-revoker") {
    fields(node, ["kind", "proxy", "state"]);
    if (node.proxy !== null) reference(node.proxy, ["guest-proxy"]);
    state(node.state);
  } else if (node.kind === "thenable-state") {
    fields(node, ["kind", "source", "owner", "completed"], ["settlement"]);
    reference(node.source);
    if (!absent(node.owner)) {
      const owner = reference(node.owner, ["pending-promise", "promise-reaction", "guest-promise"]);
      if (node.completed === false && (owner.kind !== "pending-promise" || owner.thenable === undefined ||
          reference(owner.thenable, ["thenable-state"]) !== node)) throw new TypeError("Invalid thenable owner linkage.");
    }
    if (typeof node.completed !== "boolean" || node.completed !== Object.hasOwn(node, "settlement"))
      throw new TypeError("Invalid thenable settlement phase.");
    if (node.settlement !== undefined) {
      const settlement = record(node.settlement);
      fields(settlement, ["state", "value"]);
      if (settlement.state !== "fulfilled" && settlement.state !== "rejected") throw new TypeError("Invalid thenable settlement status.");
    }
  } else if (node.kind === "thenable-resolver") {
    fields(node, ["kind", "continuation", "action", "state"]);
    reference(node.continuation, ["thenable-state"]);
    if (node.action !== "fulfilled" && node.action !== "rejected") throw new TypeError("Invalid thenable resolver action.");
    state(node.state);
  } else if (node.kind === "construction-environment") {
    fields(node, ["kind", "constructor", "newTarget", "prototype", "thisValue", "thisScope", "initialized"]);
    const owner = reference(node.constructor, ["guest-class"]);
    callable(node.newTarget);
    const prototype = reference(node.prototype);
    const scope = reference(node.thisScope, ["scope-frame"]);
    if (typeof node.initialized !== "boolean") throw new TypeError("Invalid construction initialization flag.");
    if (!node.initialized && !absent(node.thisValue)) throw new TypeError("Uninitialized construction cannot have this value.");
    const property = array(record(record(owner.state).properties).properties).map(array).find(entry => entry[0] === "prototype");
    if (property === undefined || record(property[1]).kind !== "data" || reference(record(property[1]).value) !== prototype)
      throw new TypeError("Invalid construction prototype ownership.");
    if (absent(scope.parent) || reference(scope.parent, ["scope-frame"]) !== reference(owner.scope, ["scope-frame"]))
      throw new TypeError("Invalid construction scope ownership.");
    const binding = array(scope.bindings).map(array).find(entry => entry[0] === "this");
    if (binding === undefined) throw new TypeError("Invalid construction this binding.");
    const cell = record(array(scope.cells)[integer(binding[1])]);
    if (cell.kind !== "const" || cell.initialized !== node.initialized ||
        (node.initialized && reference(cell.value) !== reference(node.thisValue)))
      throw new TypeError("Invalid construction this binding.");
  } else if (node.kind === "capability-executor") {
    fields(node, ["kind", "resolve", "reject", "state"]);
    state(node.state);
  } else if (node.kind === "promise-aggregate") {
    fields(node, ["kind", "method", "capability", "values", "remaining", "size", "iteration"]);
    if (!["all", "allSettled", "race", "any"].includes(String(node.method))) throw new TypeError("Invalid promise aggregate method.");
    const size = integer(node.size);
    if (size > maxArrayLength || (node.iteration !== "complete" && node.iteration !== "abrupt")) throw new TypeError("Invalid promise aggregate iteration.");
    if (integer(node.remaining) > size + (node.iteration === "abrupt" ? 1 : 0)) throw new TypeError("Invalid promise aggregate remaining count.");
    reference(node.values, ["array", "guest-array"]);
    const capability = record(node.capability);
    fields(capability, ["promise", "resolve", "reject"]);
    if (absent(capability.resolve) || absent(capability.reject)) throw new TypeError("Missing promise aggregate resolver.");
    callable(capability.resolve);
    callable(capability.reject);
  } else if (node.kind === "aggregate-entry") {
    fields(node, ["kind", "aggregate", "index", "called"]);
    const aggregate = reference(node.aggregate, ["promise-aggregate"]);
    if (integer(node.index) >= integer(aggregate.size) || typeof node.called !== "boolean") throw new TypeError("Invalid promise aggregate entry.");
  } else if (node.kind === "aggregate-handler") {
    fields(node, ["kind", "entry", "action", "state"]);
    state(node.state);
    const entry = reference(node.entry, ["aggregate-entry"]);
    const aggregate = reference(entry.aggregate, ["promise-aggregate"]);
    if ((node.action !== "fulfilled" && node.action !== "rejected") ||
        (aggregate.method === "all" && node.action !== "fulfilled") ||
        (aggregate.method === "any" && node.action !== "rejected") || aggregate.method === "race")
      throw new TypeError("Invalid promise aggregate handler action.");
  } else if (node.kind === "promise-adoption") {
    fields(node, ["kind", "owner", "source"]);
    const owner = reference(node.owner, ["pending-promise"]);
    if (reference(owner.adoption, ["promise-adoption"]) !== node) throw new TypeError("Invalid promise adoption owner.");
    const source = reference(node.source, ["pending-promise", "promise-reaction", "guest-promise"]);
    if (source === owner)
      throw new TypeError("A promise cannot adopt itself.");
    let matchingCallbacks = 0;
    for (const entry of array(source.reactions)) {
      const reaction = reference(entry, ["promise-reaction"]);
      const handlers = [reaction.onFulfilled, reaction.onRejected].map(value => {
        if (value === null || typeof value !== "object" || record(value).kind !== "ref") return undefined;
        const handler = reference(value);
        return handler.kind === "adoption-resolver" && reference(handler.bridge, ["promise-adoption"]) === node ? handler : undefined;
      });
      if (handlers.every(handler => handler === undefined)) continue;
      if (handlers[0]?.action !== "fulfilled" || handlers[1]?.action !== "rejected")
        throw new TypeError("Invalid promise adoption callbacks.");
      matchingCallbacks++;
    }
    if (matchingCallbacks !== 1) throw new TypeError("Invalid promise adoption callbacks.");
  } else if (node.kind === "adoption-resolver") {
    fields(node, ["kind", "bridge", "action"]);
    reference(node.bridge, ["promise-adoption"]);
    if (node.action !== "fulfilled" && node.action !== "rejected") throw new TypeError("Invalid adoption resolver action.");
  } else if (node.kind === "promise-resolver") {
    fields(node, ["kind", "promise", "state"], ["action"]);
    const target = reference(node.promise, ["guest-promise", "pending-promise"]);
    if ((target.kind === "pending-promise" || Object.hasOwn(node, "action")) && node.action !== "fulfilled" && node.action !== "rejected")
      throw new TypeError("Invalid promise resolver action.");
    state(node.state);
  } else if (node.kind === "pending-promise" || node.kind === "promise-reaction") {
    fields(node, node.kind === "pending-promise" ? ["kind", "reactions", "state"] : ["kind", "source", "onFulfilled", "onRejected", "reactions", "state"], node.kind === "pending-promise" ? ["adoption", "thenable", "producers", "generatorOwner"] : ["capability", "aggregate", "producers"]);
    if (node.kind === "pending-promise" && Object.hasOwn(node, "thenable")) {
      const continuation = reference(node.thenable, ["thenable-state"]);
      if (Object.hasOwn(node, "adoption") || continuation.completed !== false || reference(continuation.owner) !== node)
        throw new TypeError("Invalid thenable promise owner.");
    }
    if (node.kind === "pending-promise" && Object.hasOwn(node, "adoption")) {
      const bridge = reference(node.adoption, ["promise-adoption"]);
      if (reference(bridge.owner, ["pending-promise"]) !== node) throw new TypeError("Invalid promise adoption owner.");
    }
    if (node.kind === "promise-reaction") {
      if (Object.hasOwn(node, "aggregate")) {
        const aggregate = reference(node.aggregate, ["pending-promise", "guest-promise", "promise-reaction"]);
        if (aggregate === node || !Array.isArray(aggregate.producers) || !aggregate.producers.some(entry => reference(entry, ["promise-reaction"]) === node))
          throw new TypeError("Invalid promise aggregate producer ownership.");
        for (const value of [node.onFulfilled, node.onRejected]) {
          if (absent(value)) continue;
          const handler = reference(value);
          let owner: Record<string, unknown> | undefined;
          if (handler.kind === "promise-resolver") owner = reference(handler.promise);
          else if (handler.kind === "aggregate-handler") {
            const entry = reference(handler.entry, ["aggregate-entry"]);
            const state = reference(entry.aggregate, ["promise-aggregate"]);
            owner = reference(record(state.capability).promise);
          }
          else if (handler.kind === "async-cleanup-handler") {
            const cleanup = reference(handler.cleanup, ["async-cleanup"]);
            owner = reference(record(cleanup.capability).promise);
          }
          else if (handler.kind === "async-function-handler") {
            const driver = reference(handler.driver, ["async-function-driver"]);
            owner = reference(record(driver.capability).promise);
          }
          else if (handler.kind === "async-generator-handler") owner = reference(handler.owner);
          if (owner !== undefined && owner !== aggregate) throw new TypeError("Invalid promise aggregate handler ownership.");
        }
      }
      if (Object.hasOwn(node, "capability")) {
        const capability = record(node.capability);
        fields(capability, ["promise", "resolve", "reject"]);
        const result = reference(capability.promise, ["pending-promise", "guest-promise", "promise-reaction"]);
        if (result === node) throw new TypeError("Invalid promise producer ownership.");
        if (!Array.isArray(result.producers) || !result.producers.some(entry => reference(entry, ["promise-reaction"]) === node))
          throw new TypeError("Unlisted promise producer.");
        if (absent(capability.resolve) || absent(capability.reject)) throw new TypeError("Missing promise producer resolver.");
        callable(capability.resolve);
        callable(capability.reject);
      }
      const source = reference(node.source, ["pending-promise", "promise-reaction", "guest-promise"]);
      if (!Array.isArray(source.reactions) || !source.reactions.some(entry => reference(entry, ["promise-reaction"]) === node))
        throw new TypeError("Unlisted promise reaction.");
    }
    if (!Array.isArray(node.reactions)) throw new TypeError("Invalid promise reactions.");
    const reactions = new Set<unknown>();
    for (const entry of node.reactions) {
      const reaction = reference(entry, ["promise-reaction"]);
      if (reactions.has(reaction)) throw new TypeError("Duplicate promise reaction.");
      if (reference(reaction.source) !== node) throw new TypeError("Invalid promise reaction source.");
      reactions.add(reaction);
    }
    state(node.state);
  } else if (node.kind === "guest-promise") {
    fields(node, ["kind", "status", "value", "state"], ["reactions", "producers", "generatorOwner"]);
    if (Object.hasOwn(node, "reactions")) {
      if (!Array.isArray(node.reactions)) throw new TypeError("Invalid promise reactions.");
      const reactions = new Set<unknown>();
      for (const entry of node.reactions) {
        const reaction = reference(entry, ["promise-reaction"]);
        if (reactions.has(reaction) || reference(reaction.source) !== node) throw new TypeError("Invalid promise reaction source.");
        reactions.add(reaction);
      }
    }
    if (node.status !== "fulfilled" && node.status !== "rejected") throw new TypeError("Invalid guest promise settlement.");
    if (node.status === "fulfilled" && node.value !== null && typeof node.value === "object" &&
        record(node.value).kind === "ref" && reference(node.value) === node)
      throw new TypeError("A promise cannot fulfill with itself.");
    state(node.state);
  } else if (node.kind === "guest-regex") {
    fields(node, ["kind", "source", "flags", "state"]);
    if (typeof node.source !== "string" || typeof node.flags !== "string") throw new TypeError("Invalid guest RegExp payload.");
    state(node.state);
  } else if (node.kind === "guest-datetimeformat") {
    fields(node, ["kind", "options", "state"], ["format"]);
    const options = record(node.options);
    fields(options, ["locale", "calendar", "numberingSystem", "timeZone"], ["hourCycle", "hour12", "weekday", "era", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName", "dateStyle", "timeStyle"]);
    if (typeof options.locale !== "string" || Object.values(options).some(value => !["string", "number", "boolean"].includes(typeof value)))
      throw new TypeError("Invalid DateTimeFormat option type.");
    const restored = dateTimeFormatState(createSandboxDateTimeFormat(options.locale, options as DateTimeFormatOptions, true)).options;
    if (Object.keys(options).length !== Object.keys(restored).length || Object.keys(restored).some(key => options[key] !== restored[key]))
      throw new TypeError("Invalid resolved DateTimeFormat options.");
    if (node.format !== undefined) {
      const format = reference(node.format, ["bound-function"]);
      if (reference(format.thisValue) !== node || array(format.args).length !== 0 || format.name !== "" || format.length !== 1 ||
          reference(format.target, ["intrinsic"]).id !== '["%DateTimeFormatFormat%"]')
        throw new TypeError("Invalid cached DateTimeFormat function.");
    }
    state(node.state);
  } else if (node.kind === "guest-numberformat") {
    fields(node, ["kind", "options", "state"], ["format"]);
    const options = record(node.options);
    fields(options, ["locale"], ["numberingSystem", "style", "currency", "currencyDisplay", "currencySign", "unit", "unitDisplay", "minimumIntegerDigits", "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits", "useGrouping", "notation", "compactDisplay", "signDisplay", "roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay"]);
    if (typeof options.locale !== "string" || Object.values(options).some(value => !["string", "number", "boolean"].includes(typeof value)))
      throw new TypeError("Invalid NumberFormat option type.");
    const restored = numberFormatState(createSandboxNumberFormat(options.locale, options as NumberFormatOptions)).options;
    if (Object.keys(options).length !== Object.keys(restored).length || Object.keys(restored).some(key => options[key] !== restored[key]))
      throw new TypeError("Invalid resolved NumberFormat options.");
    if (node.format !== undefined) {
      const format = reference(node.format, ["bound-function"]);
      if (reference(format.thisValue) !== node || array(format.args).length !== 0 || format.name !== "" || format.length !== 1 ||
          reference(format.target, ["intrinsic"]).id !== '["%NumberFormatFormat%"]')
        throw new TypeError("Invalid cached NumberFormat function.");
    }
    state(node.state);
  } else if (node.kind === "guest-listformat") {
    fields(node, ["kind", "options", "state"]);
    const options = record(node.options);
    const names = ["locale", "type", "style"] as const;
    fields(options, [...names]);
    if (names.some(key => typeof options[key] !== "string")) throw new TypeError("Invalid ListFormat option type.");
    const restored = listFormatState(createSandboxListFormat(options.locale as string, options as Intl.ListFormatOptions)).options;
    if (names.some(key => options[key] !== restored[key])) throw new TypeError("Invalid resolved ListFormat options.");
    state(node.state);
  } else if (node.kind === "guest-segmenter") {
    fields(node, ["kind", "options", "state"]);
    const options = record(node.options);
    fields(options, ["locale", "granularity"]);
    if (typeof options.locale !== "string" || typeof options.granularity !== "string") throw new TypeError("Invalid Segmenter options.");
    const restored = segmenterState(createSandboxSegmenter(options.locale, options as Intl.SegmenterOptions)).options;
    if (options.locale !== restored.locale || options.granularity !== restored.granularity) throw new TypeError("Invalid resolved Segmenter options.");
    state(node.state);
  } else if (node.kind === "guest-segments") {
    fields(node, ["kind", "segmenter", "input", "state"], ["index"]);
    const segmenter = reference(node.segmenter, ["guest-segmenter"]);
    if (typeof node.input !== "string") throw new TypeError("Invalid segments input.");
    if (node.index !== undefined) {
      if (!Number.isSafeInteger(node.index) || (node.index as number) < 0 || (node.index as number) > node.input.length)
        throw new TypeError("Invalid segment iterator index.");
      const options = record(segmenter.options);
      const owner = createSandboxSegmenter(options.locale as string, options as Intl.SegmenterOptions);
      const value = createSandboxSegments({ segmenter: owner, input: node.input });
      if ((node.index as number) < node.input.length && segmentState(value).native.containing(node.index as number)?.index !== node.index)
        throw new TypeError("Invalid segment iterator boundary.");
    }
    state(node.state);
  } else if (node.kind === "guest-durationformat") {
    fields(node, ["kind", "settings", "state"]);
    const settings = record(node.settings);
    fields(settings, ["locale", "numberingSystem", "separator", "style", "units"], ["fractionalDigits"]);
    if (typeof settings.locale !== "string" || typeof settings.numberingSystem !== "string" ||
        !["long", "short", "narrow", "digital"].includes(settings.style as string) ||
        settings.fractionalDigits !== undefined && (!Number.isInteger(settings.fractionalDigits) || (settings.fractionalDigits as number) < 0 || (settings.fractionalDigits as number) > 9))
      throw new TypeError("Invalid duration settings.");
    const locale = resolveDurationLocale([settings.locale], { numberingSystem: settings.numberingSystem });
    if (locale.locale !== settings.locale || locale.numberingSystem !== settings.numberingSystem || locale.separator !== settings.separator)
      throw new TypeError("Invalid resolved duration locale.");
    const units = record(settings.units);
    const names = ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "milliseconds", "microseconds", "nanoseconds"];
    fields(units, names);
    let previous = "";
    for (const name of names) {
      const unit = record(units[name]);
      fields(unit, ["style", "display"]);
      const clock = ["hours", "minutes", "seconds"].includes(name);
      const subsecond = ["milliseconds", "microseconds", "nanoseconds"].includes(name);
      const allowed = ["long", "short", "narrow", ...(clock ? ["numeric", "2-digit"] : []), ...(subsecond ? ["fractional"] : [])];
      if (typeof unit.style !== "string" || !allowed.includes(unit.style) || !["always", "auto"].includes(unit.display as string) ||
          unit.style === "fractional" && unit.display !== "auto" ||
          previous === "fractional" && unit.style !== "fractional" ||
          ["numeric", "2-digit"].includes(previous) && !["numeric", "2-digit", "fractional"].includes(unit.style) ||
          ["minutes", "seconds"].includes(name) && ["numeric", "2-digit"].includes(previous) && unit.style !== "2-digit")
        throw new TypeError("Invalid duration unit options.");
      if (clock || name === "milliseconds" || name === "microseconds") previous = unit.style;
    }
    state(node.state);
  } else if (node.kind === "guest-pluralrules") {
    fields(node, ["kind", "options", "state"]);
    const options = record(node.options);
    fields(options, ["locale", "type", "minimumIntegerDigits", "pluralCategories", "roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay"],
      ["minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits"]);
    if (typeof options.locale !== "string" || !Array.isArray(options.pluralCategories) ||
        options.pluralCategories.some(value => typeof value !== "string") ||
        Object.entries(options).some(([key, value]) => key !== "pluralCategories" && typeof value !== "string" && typeof value !== "number"))
      throw new TypeError("Invalid PluralRules option type.");
    const restored = pluralRulesState(createSandboxPluralRules(options.locale, options as ResolvedPluralRulesOptions)).options;
    if (Object.keys(options).length !== Object.keys(restored).length || Object.keys(restored).some(key => {
      const value = restored[key];
      return Array.isArray(value) ? (options[key] as string[]).length !== value.length || value.some((item, index) => (options[key] as string[])[index] !== item)
        : options[key] !== value;
    })) throw new TypeError("Invalid resolved PluralRules options.");
    state(node.state);
  } else if (node.kind === "guest-displaynames") {
    fields(node, ["kind", "options", "state"]);
    const options = record(node.options);
    fields(options, ["locale", "style", "type", "fallback"], ["languageDisplay"]);
    if (Object.values(options).some(value => typeof value !== "string")) throw new TypeError("Invalid DisplayNames option type.");
    const restored = displayNamesState(createSandboxDisplayNames(options.locale as string, options as unknown as Intl.DisplayNamesOptions)).options;
    if (Object.keys(options).length !== Object.keys(restored).length ||
        Object.keys(restored).some(key => options[key] !== restored[key as keyof typeof restored]))
      throw new TypeError("Invalid resolved DisplayNames options.");
    state(node.state);
  } else if (node.kind === "guest-relativetimeformat") {
    fields(node, ["kind", "options", "state"]);
    const options = record(node.options);
    const names = ["locale", "numberingSystem", "style", "numeric"] as const;
    fields(options, [...names]);
    if (names.some(key => typeof options[key] !== "string")) throw new TypeError("Invalid RelativeTimeFormat option type.");
    const restored = relativeTimeFormatState(createSandboxRelativeTimeFormat(options.locale as string, options as Intl.RelativeTimeFormatOptions)).options;
    if (names.some(key => options[key] !== restored[key])) throw new TypeError("Invalid resolved RelativeTimeFormat options.");
    state(node.state);
  } else if (node.kind === "guest-collator") {
    fields(node, ["kind", "options", "state"], ["compare"]);
    const options = record(node.options);
    const names = ["locale", "usage", "sensitivity", "ignorePunctuation", "collation", "numeric", "caseFirst"];
    fields(options, names);
    for (const key of names)
      if (typeof options[key] !== (key === "numeric" || key === "ignorePunctuation" ? "boolean" : "string"))
        throw new TypeError("Invalid Collator option type.");
    const restored = collatorState(createSandboxCollator(options.locale as string, options as Record<string, string | boolean>)).options;
    for (const key of names)
      if (options[key] !== restored[key as keyof typeof restored]) throw new TypeError("Invalid resolved Collator options.");
    if (node.compare !== undefined) {
      const compare = reference(node.compare, ["bound-function"]);
      if (reference(compare.thisValue) !== node || array(compare.args).length !== 0 || compare.name !== "" || compare.length !== 2 ||
          reference(compare.target, ["intrinsic"]).id !== '["%CollatorCompare%"]')
        throw new TypeError("Invalid cached Collator comparison.");
    }
    state(node.state);
  } else if (node.kind === "guest-locale") {
    fields(node, ["kind", "tag", "state"]);
    if (typeof node.tag !== "string" || localeTag(createSandboxLocale(node.tag)) !== node.tag)
      throw new TypeError("Invalid canonical Locale tag.");
    state(node.state);
  } else if (node.kind === "guest-boxed" || node.kind === "guest-date") {
    fields(node, ["kind", "value", "state"]);
    if (node.kind === "guest-date") {
      if (typeof node.value !== "number" && record(node.value).kind !== "number") throw new TypeError("Invalid guest date time.");
    } else if (!["number", "string", "boolean"].includes(typeof node.value)) {
      const payload = record(node.value);
      if (payload.kind === "ref") reference(node.value, ["symbol"]);
      else if (payload.kind !== "number" && payload.kind !== "bigint") throw new TypeError("Invalid guest boxed payload.");
    }
    state(node.state);
  } else if (node.kind === "iterator-helper") {
    fields(node, ["kind", "method", "status", "callback", "remaining", "index", "state"], ["outer", "inner"]);
    if (!["map", "filter", "take", "drop", "flatMap"].includes(String(node.method)) ||
        !["start", "yield", "done"].includes(String(node.status))) throw new TypeError("Invalid iterator helper mode.");
    integer(node.index);
    if (node.remaining !== "Infinity" && (typeof node.remaining !== "number" || !Number.isInteger(node.remaining) || node.remaining < 0))
      throw new TypeError("Invalid iterator helper limit.");
    for (const key of ["outer", "inner"]) {
      if (!Object.hasOwn(node, key)) continue;
      const cursor = record(node[key]);
      fields(cursor, ["iterator", "next"]);
      const target = reference(cursor.iterator);
      if (target.kind === "symbol" || target.kind === "scope-frame") throw new TypeError("Invalid helper iterator.");
    }
    if ((node.status === "done") === Object.hasOwn(node, "outer") ||
        (Object.hasOwn(node, "inner") && (node.method !== "flatMap" || node.status !== "yield")))
      throw new TypeError("Invalid iterator helper cursor state.");
    if (node.status === "done" || node.method === "take" || node.method === "drop") {
      if (!absent(node.callback)) throw new TypeError("Unexpected iterator helper callback.");
    } else {
      if (absent(node.callback)) throw new TypeError("Missing iterator helper callback.");
      callable(node.callback);
    }
    state(node.state);
  } else if (node.kind === "iterator-wrapper") {
    fields(node,["kind","iterator","next","state"]);
    const iterator=reference(node.iterator);
    if (iterator.kind === "symbol" || iterator.kind === "scope-frame") throw new TypeError("Invalid wrapped iterator.");
    state(node.state);
  } else if (node.kind === "disposable-stack") {
    fields(node, ["kind", "disposed", "resources", "state"]);
    const resources = array(node.resources);
    if (typeof node.disposed !== "boolean" || resources.length > maxArrayLength)
      throw new TypeError("Invalid disposable stack state.");
    for (const rawResource of resources) {
      const resource = record(rawResource);
      fields(resource, ["method", "receiver", "args"]);
      if (absent(resource.method)) throw new TypeError("Missing disposer.");
      callable(resource.method);
      if (array(resource.args).length > 1) throw new TypeError("Invalid disposer arguments.");
    }
    state(node.state);
  } else if (node.kind === "async-disposable-stack" || node.kind === "async-cleanup") {
    fields(node, node.kind === "async-disposable-stack" ? ["kind", "disposed", "resources", "state"] :
      ["kind", "resources", "capability", "phase", "failed", "failure", "needsAwait", "hasAwaited", "generation"]);
    const resources = array(node.resources);
    if (resources.length > maxArrayLength) throw new TypeError("Too many async resources.");
    for (const rawResource of resources) {
      const resource = record(rawResource);
      fields(resource, ["method", "receiver", "args", "syncFallback"], ["synchronous"]);
      if (resource.synchronous !== undefined && (resource.synchronous !== true || resource.syncFallback || absent(resource.method))) throw new TypeError("Invalid synchronous resource.");
      const args = array(resource.args);
      if (typeof resource.syncFallback !== "boolean" || args.length > 1) throw new TypeError("Invalid async resource.");
      if (absent(resource.method)) {
        if (!absent(resource.receiver) || args.length !== 0 || resource.syncFallback) throw new TypeError("Invalid nullish resource.");
      } else callable(resource.method);
    }
    if (node.kind === "async-disposable-stack") {
      if (typeof node.disposed !== "boolean") throw new TypeError("Invalid async stack state.");
      state(node.state);
    } else {
      if (!["waiting", "done"].includes(String(node.phase)) || typeof node.failed !== "boolean" ||
          typeof node.needsAwait !== "boolean" || typeof node.hasAwaited !== "boolean" || (!node.failed && !absent(node.failure)))
        throw new TypeError("Invalid async cleanup state.");
      integer(node.generation);
      const capability = record(node.capability);
      fields(capability, ["promise", "resolve", "reject"]);
      const owner = reference(capability.promise, ["pending-promise", "guest-promise"]);
      for (const key of ["resolve", "reject"]) {
        if (absent(capability[key])) throw new TypeError("Missing cleanup resolver.");
        const resolver = reference(capability[key], ["promise-resolver"]);
        if (reference(resolver.promise) !== owner ||
            (resolver.action !== undefined && resolver.action !== (key === "resolve" ? "fulfilled" : "rejected")))
          throw new TypeError("Invalid async cleanup resolver ownership.");
      }
    }
  } else if (node.kind === "async-generator-driver") {
    fields(node, ["kind", "generator", "requests", "phase", "suspension", "awaitKind", "generation"]);
    const generator = reference(node.generator, ["guest-generator"]);
    if (generator.async !== true || generator.asyncFunction !== undefined || reference(generator.driver) !== node ||
        !["idle", "waiting"].includes(String(node.phase)) || !["await", "yield"].includes(String(node.suspension)) ||
        !["body", "return"].includes(String(node.awaitKind))) throw new TypeError("Invalid async generator driver.");
    integer(node.generation);
    if (!Array.isArray(node.requests) || (node.phase === "idle") !== (node.requests.length === 0)) throw new TypeError("Invalid async generator request queue.");
    if (node.phase === "waiting" && (node.awaitKind === "body"
      ? generator.state !== "suspended" || generator.awaitPhase === undefined || node.suspension !== "await"
      : generator.state !== "done")) throw new TypeError("Invalid async generator wait position.");
    const owners = new Set<object>();
    for (const value of node.requests) {
      const request = record(value);
      fields(request, ["method", "value", "capability"]);
      if (!["next", "return", "throw"].includes(String(request.method))) throw new TypeError("Invalid async generator request operation.");
      const capability = record(request.capability);
      fields(capability, ["promise", "resolve", "reject"]);
      const owner = reference(capability.promise, ["pending-promise", "guest-promise"]);
      if (owners.has(owner)) throw new TypeError("Duplicate async generator request owner.");
      if (reference(owner.generatorOwner, ["async-generator-driver"]) !== node) throw new TypeError("Invalid async generator request ownership.");
      owners.add(owner);
      for (const key of ["resolve", "reject"]) {
        const resolver = reference(capability[key], ["promise-resolver"]);
        if (reference(resolver.promise) !== owner || (resolver.action !== undefined && resolver.action !== (key === "resolve" ? "fulfilled" : "rejected")))
          throw new TypeError("Invalid async generator resolver ownership.");
      }
    }
  } else if (node.kind === "async-generator-handler") {
    fields(node, ["kind", "driver", "owner", "action", "generation", "state"]);
    const driver = reference(node.driver, ["async-generator-driver"]);
    const owner = reference(node.owner, ["pending-promise", "guest-promise"]);
    if (!["fulfilled", "rejected"].includes(String(node.action)) || integer(node.generation) > integer(driver.generation)) throw new TypeError("Invalid async generator handler.");
    if (driver.phase === "waiting" && node.generation === driver.generation &&
        reference(record(record((driver.requests as unknown[])[0]).capability).promise) !== owner) throw new TypeError("Invalid async generator active handler owner.");
    state(node.state);
  } else if (node.kind === "async-function-driver") {
    fields(node, ["kind", "generator", "capability", "phase", "generation"]);
    const generator = reference(node.generator, ["guest-generator"]);
    if (generator.asyncFunction !== true || !["waiting", "done"].includes(String(node.phase))) throw new TypeError("Invalid async function frame.");
    integer(node.generation);
    const capability = record(node.capability);
    fields(capability, ["promise", "resolve", "reject"]);
    const owner = reference(capability.promise, ["pending-promise", "guest-promise"]);
    for (const key of ["resolve", "reject"]) {
      const resolver = reference(capability[key], ["promise-resolver"]);
      if (reference(resolver.promise) !== owner || (resolver.action !== undefined && resolver.action !== (key === "resolve" ? "fulfilled" : "rejected")))
        throw new TypeError("Invalid async function resolver ownership.");
    }
  } else if (node.kind === "async-function-handler") {
    fields(node, ["kind", "driver", "action", "generation", "state"]);
    const driver = reference(node.driver, ["async-function-driver"]);
    if ((node.action !== "fulfilled" && node.action !== "rejected") || integer(node.generation) > integer(driver.generation)) throw new TypeError("Invalid async function handler.");
    state(node.state);
  } else if (node.kind === "async-cleanup-handler") {
    fields(node, ["kind", "cleanup", "action", "generation", "state"]);
    const cleanup = reference(node.cleanup, ["async-cleanup"]);
    if ((node.action !== "fulfilled" && node.action !== "rejected") || integer(node.generation) > integer(cleanup.generation))
      throw new TypeError("Invalid async cleanup handler.");
    state(node.state);
  } else if (node.kind === "module-function") {
    fields(node, ["kind", "module", "path", "state"], ["name"]);
    if (typeof node.module !== "string" || !Array.isArray(node.path) || node.path.length === 0 ||
        node.path.some(key => typeof key !== "string") || (node.name !== undefined && typeof node.name !== "string"))
      throw new TypeError("Invalid module function identity.");
    state(node.state);
  } else if (node.kind === "intrinsic") {
    fields(node, ["kind", "id"], ["state", "symbolRegistry"]);
    if (typeof node.id !== "string" || !intrinsicCatalogue().has(node.id)) throw new TypeError("Unknown intrinsic identity.");
    if (Object.hasOwn(node, "symbolRegistry")) {
      if (![JSON.stringify(["Symbol"]), JSON.stringify(["Symbol", "for"]), JSON.stringify(["Symbol", "keyFor"])].includes(node.id) || !Array.isArray(node.symbolRegistry))
        throw new TypeError("Invalid symbol registry owner.");
      const keys = new Set<string>();
      const symbols = new Set<unknown>();
      for (const entry of node.symbolRegistry) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || keys.has(entry[0]))
          throw new TypeError("Invalid symbol registry entry.");
        const symbol = reference(entry[1], ["symbol"]);
        if (symbol.wellKnown !== undefined || symbol.description !== entry[0] || symbols.has(symbol))
          throw new TypeError("Invalid registered symbol identity.");
        keys.add(entry[0]);
        symbols.add(symbol);
      }
    }
    if (Object.hasOwn(node, "state")) state(node.state);
  } else if (node.kind === "guest-regexp-iterator") {
    fields(node, ["kind", "matcher", "input", "exhausted", "state"], ["global", "unicode"]);
    if (typeof node.exhausted !== "boolean" || (typeof node.input !== "string" && !absent(node.input)))
      throw new TypeError("Invalid RegExp iterator state.");
    if ((Object.hasOwn(node, "global") || Object.hasOwn(node, "unicode")) &&
        (typeof node.global !== "boolean" || typeof node.unicode !== "boolean"))
      throw new TypeError("Invalid RegExp iterator modes.");
    if (absent(node.matcher)) {
      if (!node.exhausted) throw new TypeError("Live RegExp iterator requires a matcher.");
    } else {
      const matcher = reference(node.matcher);
      if (matcher.kind === "symbol" || matcher.kind === "scope-frame") throw new TypeError("Invalid RegExp iterator matcher.");
    }
    if (!node.exhausted && absent(node.input)) throw new TypeError("Live RegExp iterator requires input.");
    state(node.state);
  } else if (node.kind === "guest-collection-iterator") {
    fields(node, ["kind", "collectionKind", "method", "collection", "index", "exhausted", "state"]);
    if (!["map", "set"].includes(String(node.collectionKind)) || !["keys", "values", "entries"].includes(String(node.method)) || typeof node.exhausted !== "boolean")
      throw new TypeError("Invalid collection iterator state.");
    integer(node.index);
    if (absent(node.collection)) {
      if (!node.exhausted || node.index !== 0) throw new TypeError("Invalid exhausted collection iterator.");
    } else reference(node.collection, [String(node.collectionKind)]);
    state(node.state);
  } else if (node.kind === "string-iterator") {
    fields(node, ["kind", "input", "index", "state"]);
    const index = integer(node.index);
    if (typeof node.input !== "string" && !absent(node.input))
      throw new TypeError("Invalid String iterator state.");
    validateStringIteratorState({ input: typeof node.input === "string" ? node.input : undefined, index });
    state(node.state);
  } else if (node.kind === "array-iterator") {
    fields(node, ["kind", "source", "index", "method", "state"]);
    integer(node.index);
    if (!["keys", "values", "entries"].includes(String(node.method))) throw new TypeError("Invalid Array iterator method.");
    if (!absent(node.source)) {
      const source = reference(node.source);
      if (source.kind === "scope-frame" || source.kind === "symbol") throw new TypeError("Invalid Array iterator source.");
    }
    state(node.state);
  } else if (node.kind === "guest-object" || node.kind === "guest-array") {
    fields(node, ["kind", "state"], node.kind === "guest-array" ? ["templateNodeId", "templateOwner", "dynamicSource"] : ["errorType"]);
    if (node.dynamicSource !== undefined) {
      reference(node.dynamicSource, ["guest-source", "guest-script"]);
      if (node.templateNodeId === undefined) throw new TypeError("Dynamic template source requires a template identity.");
    }
    if (Object.hasOwn(node, "errorType") && !sandboxErrorNames.includes(node.errorType as SandboxErrorName))
      throw new TypeError("Invalid guest error type.");
    if (Object.hasOwn(node, "templateOwner")) reference(node.templateOwner, ["guest-array"]);
    if (Object.hasOwn(node, "templateNodeId") && integer(node.templateNodeId) < 1)
      throw new TypeError("Invalid template source identity.");
    state(node.state);
    if (node.kind === "guest-array") {
      const properties = array(record(record(node.state).properties).properties).map(entry => array(entry));
      const length = properties.find(entry => entry[0] === "length");
      if (length === undefined) throw new TypeError("Missing guest array length.");
      const descriptor = record(length[1]);
      if (descriptor.kind !== "data" || descriptor.configurable !== false || descriptor.enumerable !== false ||
          integer(descriptor.value) > 0xffffffff) throw new TypeError("Invalid guest array length.");
      if ((descriptor.value as number) > maxArrayLength) throw new TypeError("Guest array length exceeds allocation limit.");
      for (const [key] of properties) {
        if (typeof key !== "string") continue;
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key &&
            index >= (descriptor.value as number)) throw new TypeError("Guest array index exceeds length.");
      }
    }
  } else if (node.kind === "guest-class") {
    fields(node, ["kind", "astNodeId", "scope", "state", "fields"], ["name", "privateMethods", "dynamicSource"]);
    if (node.dynamicSource !== undefined) reference(node.dynamicSource, ["guest-source", "guest-script"]);
    if (node.privateMethods !== undefined) privateState(node.privateMethods, true);
    if (integer(node.astNodeId) < 1) throw new TypeError("Invalid class AST identity.");
    reference(node.scope, ["scope-frame"]);
    if (Object.hasOwn(node, "name") && typeof node.name !== "string") throw new TypeError("Invalid class name.");
    let previous = -1;
    for (const item of array(node.fields)) {
      const field = record(item);
      fields(field, ["index", "key"], ["privateName"]);
      if (field.privateName !== undefined) {
        if (typeof field.key !== "string" || !field.key.startsWith("#")) throw new TypeError("Invalid private field key.");
        privateIdentity(field.privateName, field.key.slice(1));
      }
      const index = integer(field.index);
      if (index <= previous) throw new TypeError("Invalid class field order.");
      previous = index;
      if (typeof field.key !== "string") reference(field.key, ["symbol"]);
    }
    state(node.state);
    const prototype = array(record(record(node.state).properties).properties).map(item => array(item)).find(entry => entry[0] === "prototype");
    if (prototype === undefined) throw new TypeError("Missing class prototype descriptor.");
    const descriptor = record(prototype[1]);
    if (descriptor.kind !== "data" || descriptor.writable !== false || descriptor.enumerable !== false || descriptor.configurable !== false)
      throw new TypeError("Invalid class prototype descriptor.");
    reference(descriptor.value, ["object", "guest-object"]);
  } else if (node.kind === "bound-function") {
    fields(node, ["kind", "target", "thisValue", "args", "length", "state"], ["name"]);
    if (Object.hasOwn(node, "name") && typeof node.name !== "string") throw new TypeError("Invalid bound function name.");
    if (array(node.args).length > maxArrayLength) throw new TypeError("Bound arguments exceed allocation limit.");
    if (!absent(node.length) && !(typeof node.length === "number" && node.length >= 0) &&
        !(record(node.length).kind === "number" && record(node.length).value === "Infinity"))
      throw new TypeError("Invalid bound function length.");
    const visited = new Set<unknown>([raw]);
    let current = node;
    while (current.kind === "bound-function") {
      assertSnapshotDataDepth(visited.size, "<bound-target>");
      callable(current.target);
      current = reference(current.target);
      if (visited.has(current)) throw new TypeError("Cyclic bound function target.");
      visited.add(current);
    }
    state(node.state);
  } else if (node.kind === "guest-function") {
    fields(node, ["kind", "astNodeId", "scope", "state"], ["name", "environment", "dynamicSource"]);
    if (integer(node.astNodeId) < (node.dynamicSource === undefined ? 1 : 0)) throw new TypeError("Invalid guest AST identity.");
    if (node.dynamicSource !== undefined) reference(node.dynamicSource, ["guest-source", "guest-script"]);
    reference(node.scope, ["scope-frame"]);
    if (Object.hasOwn(node, "name") && typeof node.name !== "string") throw new TypeError("Invalid guest function name.");
    if (Object.hasOwn(node, "environment")) {
      const environment = record(node.environment);
      fields(environment, [], ["homeObject", "newTarget", "construction", "classInitializer"]);
      if (environment.classInitializer !== undefined && (environment.classInitializer !== true || !Object.hasOwn(environment, "homeObject")))
        throw new TypeError("Invalid class initializer environment.");
      if (Object.hasOwn(environment, "homeObject")) reference(environment.homeObject);
      if (Object.hasOwn(environment, "newTarget")) callable(environment.newTarget);
      if (Object.hasOwn(environment, "construction")) reference(environment.construction, ["construction-environment"]);
    }
    state(node.state);
  } else if (node.kind === "guest-generator") {
    fields(node, ["kind", "state", "astNodeId", "async", "scope", "closureScope", "sent"], ["suspendedScope", "yieldNodeId", "environment", "blockScopes", "finallyCompletions", "expressionStates", "objectState", "asyncFunction", "driver", "awaitPhase", "dynamicSource"]);
    if (node.dynamicSource !== undefined) reference(node.dynamicSource, ["guest-source", "guest-script"]);
    if (node.asyncFunction !== undefined && (node.asyncFunction !== true || node.async !== false)) throw new TypeError("Invalid async function suspension frame.");
    if (node.driver !== undefined && (node.async !== true || reference(reference(node.driver, ["async-generator-driver"]).generator) !== node)) throw new TypeError("Invalid async generator frame owner.");
    if (node.awaitPhase !== undefined && (node.driver === undefined || node.state !== "suspended" || !["await", "yield", "return", "resume-return"].includes(String(node.awaitPhase)))) throw new TypeError("Invalid async generator await phase.");
    if (Object.hasOwn(node, "objectState")) state(node.objectState);
    if (!["start", "running", "suspended", "done"].includes(String(node.state)) || typeof node.async !== "boolean" || integer(node.astNodeId) < (node.dynamicSource === undefined ? 1 : 0))
      throw new TypeError("Invalid generator state.");
    reference(node.scope, ["scope-frame"]);
    reference(node.closureScope, ["scope-frame"]);
    if (Object.hasOwn(node, "suspendedScope")) reference(node.suspendedScope, ["scope-frame"]);
    if (Object.hasOwn(node, "blockScopes")) {
      for (const [id, scope] of Object.entries(record(node.blockScopes))) {
        if (integer(Number(id)) < 1 || String(Number(id)) !== id) throw new TypeError("Invalid generator block identity.");
        reference(scope, ["scope-frame"]);
      }
    }
    if (Object.hasOwn(node, "expressionStates")) {
      for (const [id, raw] of Object.entries(record(node.expressionStates))) {
        if (integer(Number(id)) < 1 || String(Number(id)) !== id) throw new TypeError("Invalid expression identity.");
        const expression = record(raw);
        if (expression.kind === "array-pattern" || expression.kind === "object-pattern") {
          if (expression.referenceScope !== undefined || expression.referenceUnresolvable !== undefined) {
            if (!Object.hasOwn(expression, "referenceObject") || !absent(expression.referenceObject) ||
                typeof expression.referenceKey !== "string" || expression.privateName !== undefined ||
                (expression.referenceScope !== undefined && expression.referenceUnresolvable !== undefined))
              throw new TypeError("Invalid pattern binding reference.");
            if (expression.referenceScope !== undefined) reference(expression.referenceScope, ["scope-frame"]);
            if (expression.referenceUnresolvable !== undefined && expression.referenceUnresolvable !== true)
              throw new TypeError("Invalid unresolvable pattern reference.");
          }
        }
        if (expression.kind === "binary") {
          fields(expression, ["kind", "left"]);
        } else if (expression.kind === "dynamic-import") {
          fields(expression,["kind","source"]);
        } else if (expression.kind === "declaration") {
          fields(expression, ["kind", "index"]);
          integer(expression.index);
        } else if (expression.kind === "pattern-source") {
          fields(expression, ["kind", "value"]);
        } else if (expression.kind === "object-pattern") {
          fields(expression, ["kind", "phase", "index", "excludedKeys", "key", "current"], ["referenceObject", "referenceKey", "privateName", "referenceScope", "referenceUnresolvable"]);
          if (expression.privateName !== undefined && (typeof expression.privateName !== "string" || !Object.hasOwn(expression, "referenceObject"))) throw new TypeError("Invalid private pattern reference.");
          integer(expression.index);
          if (!["key", "reference", "binding"].includes(String(expression.phase)) ||
              Object.hasOwn(expression, "referenceObject") !== Object.hasOwn(expression, "referenceKey")) throw new TypeError("Invalid object pattern state.");
          for (const key of array(expression.excludedKeys)) if (typeof key !== "string") reference(key, ["symbol"]);
          if (!absent(expression.key) && typeof expression.key !== "string") reference(expression.key, ["symbol"]);
          if (Object.hasOwn(expression, "referenceObject") && expression.phase !== "binding") throw new TypeError("Invalid prepared object pattern reference.");
          if (Object.hasOwn(expression, "referenceKey") && typeof expression.referenceKey !== "string") reference(expression.referenceKey, ["symbol"]);
        } else if (expression.kind === "for-of-array" || expression.kind === "for-of-iterator" || expression.kind === "array-pattern" || expression.kind === "yield-delegate") {
          if (expression.kind === "yield-delegate") {
            fields(expression, ["kind", "async", "value", "current", "iterator"], ["phase", "awaitState", "completion"]);
            if (typeof expression.async !== "boolean") throw new TypeError("Invalid delegated yield protocol.");
            if (expression.phase !== undefined) {
              if (!["await", "close"].includes(String(expression.phase)) || expression.async !== true || node.awaitPhase !== "await" || node.yieldNodeId !== Number(id))
                throw new TypeError("Invalid delegated iterator wait position.");
              const completion = record(expression.completion);
              fields(completion, ["type", "value"]);
              if (!["normal", "return", "throw"].includes(String(completion.type)) || (expression.phase === "close" && completion.type !== "throw"))
                throw new TypeError("Invalid delegated iterator completion.");
              const awaiting = record(expression.awaitState);
              if (awaiting.kind === "result") fields(awaiting, ["kind"]);
              else if (awaiting.kind === "value") {
                fields(awaiting, ["kind", "done", "closeOnReject"]);
                if (typeof awaiting.done !== "boolean" || typeof awaiting.closeOnReject !== "boolean" ||
                    awaiting.closeOnReject !== (expression.phase === "await" && completion.type !== "return" && !awaiting.done))
                  throw new TypeError("Invalid delegated async-from-sync continuation.");
              } else throw new TypeError("Invalid delegated iterator await kind.");
            } else if (expression.awaitState !== undefined || expression.completion !== undefined)
              throw new TypeError("Unexpected delegated iterator continuation fields.");
          } else if (expression.kind === "array-pattern") {
            fields(expression, ["kind", "phase", "index", "done", "current", "iterator"], ["referenceObject", "referenceKey", "privateName", "referenceScope", "referenceUnresolvable"]);
            if (expression.privateName !== undefined && (typeof expression.privateName !== "string" || !Object.hasOwn(expression, "referenceObject"))) throw new TypeError("Invalid private pattern reference.");
            if (!["reference", "binding"].includes(String(expression.phase)) || typeof expression.done !== "boolean" ||
                Object.hasOwn(expression, "referenceObject") !== Object.hasOwn(expression, "referenceKey")) throw new TypeError("Invalid array pattern state.");
            if (Object.hasOwn(expression, "referenceKey") && typeof expression.referenceKey !== "string") reference(expression.referenceKey, ["symbol"]);
          } else {
            fields(expression, ["kind", "phase", "current", "index", "scope",
            ...(expression.kind === "for-of-array" ? ["values"] : ["value", "iterator", "async"])], ["awaitState", "closeCompletion"]);
            if (!["left", "body", "next", "close"].includes(String(expression.phase))) throw new TypeError("Invalid for-of phase.");
            if (expression.phase === "next" || expression.phase === "close") {
              if (expression.kind !== "for-of-iterator" || expression.async !== true) throw new TypeError("Invalid async iterator suspension.");
              const awaiting = record(expression.awaitState);
              if (awaiting.kind === "result") fields(awaiting, ["kind"]);
              else if (awaiting.kind === "value") {
                fields(awaiting, ["kind", "done", "closeOnReject"]);
                if (typeof awaiting.done !== "boolean" || typeof awaiting.closeOnReject !== "boolean" || awaiting.closeOnReject !== (expression.phase === "next" && !awaiting.done))
                  throw new TypeError("Invalid async-from-sync continuation.");
              } else throw new TypeError("Invalid iterator await kind.");
            } else if (Object.hasOwn(expression, "awaitState")) throw new TypeError("Unexpected iterator await state.");
            if (expression.phase === "close") {
              const completion = record(expression.closeCompletion);
              fields(completion, ["kind", "hasValue", "value"], ["span", "stackFrames", "label"]);
              if (!["normal", "return", "throw", "break", "continue"].includes(String(completion.kind)) || typeof completion.hasValue !== "boolean")
                throw new TypeError("Invalid iterator close completion.");
              if (completion.label !== undefined && typeof completion.label !== "string") throw new TypeError("Invalid iterator close label.");
              if (completion.stackFrames !== undefined && array(completion.stackFrames).some(frame => typeof frame !== "string")) throw new TypeError("Invalid iterator close stack.");
            } else if (Object.hasOwn(expression, "closeCompletion")) throw new TypeError("Unexpected iterator close completion.");
            reference(expression.scope, ["scope-frame"]);
          }
          if (expression.kind !== "yield-delegate") integer(expression.index);
          if (expression.kind === "for-of-array") reference(expression.values, ["array", "guest-array"]);
          else {
            let iterator = record(expression.iterator);
            let depth = 0;
            let protocol = false;
            while (iterator.kind === "async-from-sync") {
              if (++depth > 1) throw new TypeError("Invalid nested async iterator adapter.");
              fields(iterator, ["kind", "inner"]);
              iterator = record(iterator.inner);
              protocol = true;
            }
            if (((expression.kind === "for-of-iterator" && (expression.phase === "next" || expression.phase === "close")) ||
                 (expression.kind === "yield-delegate" && expression.phase !== undefined)) &&
                record(expression.awaitState).kind !== (depth === 1 ? "value" : "result"))
              throw new TypeError("Iterator await state does not match its adapter.");
            if (iterator.kind === "guest") {
              fields(iterator, ["kind", "value", "next", "async"]);
              if (typeof iterator.async !== "boolean") throw new TypeError("Invalid iterator protocol.");
              if (depth > 0 && iterator.async) throw new TypeError("Invalid async-from-sync source.");
              protocol ||= iterator.async;
              reference(iterator.value);
              callable(iterator.next);
            } else if (iterator.kind === "builtin") {
              fields(iterator, ["kind", "value", "index"]);
              integer(iterator.index);
              if (typeof iterator.value === "string" && (iterator.index as number) > iterator.value.length)
                throw new TypeError("Invalid string iterator cursor.");
              if (typeof iterator.value !== "string") {
                const target = reference(iterator.value, ["array", "guest-array", "map", "set", "guest-generator", "collection-iterator", "regexp-iterator"]);
                if (["guest-generator", "collection-iterator", "regexp-iterator"].includes(String(target.kind)) && iterator.index !== 0)
                  throw new TypeError("Invalid stateful iterator cursor.");
                if ((target.kind === "map" && (iterator.index as number) > array(target.entries).length) ||
                    (target.kind === "set" && (iterator.index as number) > array(target.values).length))
                  throw new TypeError("Invalid collection iterator cursor.");
                if (target.kind === "guest-generator" && target.async === true) {
                  if (depth > 0) throw new TypeError("Invalid async-from-sync generator.");
                  protocol = true;
                }
              }
            } else throw new TypeError("Invalid iterator continuation.");
            if ((expression.kind === "array-pattern" ? false : expression.async) !== protocol) throw new TypeError("Invalid iterator protocol.");
          }
        } else if (expression.kind === "for-in") {
          fields(expression, ["kind", "object", "keys", "index", "scope"], ["phase"]);
          if (Object.hasOwn(expression, "phase") && !["left", "body"].includes(String(expression.phase))) throw new TypeError("Invalid for-in phase.");
          if (array(expression.keys).some(key => typeof key !== "string") ||
              integer(expression.index) >= array(expression.keys).length) throw new TypeError("Invalid for-in continuation.");
          reference(expression.scope, ["scope-frame"]);
        } else if (expression.kind === "switch") {
          fields(expression, ["kind", "phase", "index", "statementIndex", "value", "scope"]);
          if (!["test", "body"].includes(String(expression.phase))) throw new TypeError("Invalid switch phase.");
          integer(expression.index);
          integer(expression.statementIndex);
          if (expression.phase === "test" && expression.statementIndex !== 0) throw new TypeError("Invalid switch test position.");
          reference(expression.scope, ["scope-frame"]);
        } else if (expression.kind === "for") {
          fields(expression, ["kind", "phase", "loopScope", "activeScope"]);
          if (!["init", "test", "body", "update", "dispose"].includes(String(expression.phase))) throw new TypeError("Invalid for-loop phase.");
          reference(expression.loopScope, ["scope-frame"]);
          reference(expression.activeScope, ["scope-frame"]);
        } else if (expression.kind === "identifier-assignment") {
          fields(expression, ["kind", "current"], ["referenceKind", "referenceScope", "referenceObject"]);
          if (expression.referenceKind !== undefined && !["binding", "object", "unresolvable"].includes(String(expression.referenceKind)))
            throw new TypeError("Invalid assignment reference kind.");
          if (Object.hasOwn(expression, "referenceScope") !== (expression.referenceKind === "binding") ||
              Object.hasOwn(expression, "referenceObject") !== (expression.referenceKind === "object"))
            throw new TypeError("Invalid assignment reference target.");
          if (expression.referenceKind === "binding") reference(expression.referenceScope, ["scope-frame"]);
          if (expression.referenceKind === "object") {
            const target = reference(expression.referenceObject);
            if (["scope-frame", "guest-source", "guest-script", "construction-environment", "thenable-state", "symbol"].includes(String(target.kind)))
              throw new TypeError("Invalid assignment object reference.");
          }
        } else if (expression.kind === "member-assignment") {
          fields(expression, ["kind", "object", "property", "current"], ["key", "superReceiver", "privateName"]);
          if (expression.privateName !== undefined && (typeof expression.privateName !== "string" || Object.hasOwn(expression, "key") || Object.hasOwn(expression, "superReceiver"))) throw new TypeError("Invalid private assignment reference.");
          if (Object.hasOwn(expression, "key") && typeof expression.key !== "string") reference(expression.key, ["symbol"]);
        } else if (expression.kind === "member") {
          fields(expression, ["kind", "object"], ["superReceiver"]);
        } else if (expression.kind === "template") {
          fields(expression, ["kind", "prefix", "index"]);
          integer(expression.index);
          if (typeof expression.prefix !== "string") throw new TypeError("Invalid template prefix.");
        } else if (expression.kind === "object") {
          fields(expression, ["kind", "value", "index"], ["key"]);
          integer(expression.index);
          reference(expression.value, ["object", "guest-object"]);
        } else if (expression.kind === "array") {
          fields(expression, ["kind", "values", "index"]);
          integer(expression.index);
          reference(expression.values, ["array", "guest-array"]);
        } else if (expression.kind === "call" || expression.kind === "new" || expression.kind === "tagged") {
          fields(expression, ["kind", "callee", "thisValue", "args", "index"]);
          integer(expression.index);
          reference(expression.args, ["array", "guest-array"]);
        } else if (expression.kind === "array-call") {
          fields(expression, ["kind", "target", "method", "args", "index"]);
          if (typeof expression.method !== "string") throw new TypeError("Invalid array method.");
          integer(expression.index);
          reference(expression.args, ["array", "guest-array"]);
          reference(expression.target, ["array", "guest-array"]);
        } else throw new TypeError("Invalid expression continuation.");
      }
    }
    if (Object.hasOwn(node, "finallyCompletions")) {
      for (const [id, raw] of Object.entries(record(node.finallyCompletions))) {
        if (integer(Number(id)) < 1 || String(Number(id)) !== id) throw new TypeError("Invalid finally identity.");
        const completion = record(raw);
        fields(completion, ["kind", "hasValue", "value"], ["nodeId", "label", "span", "stackFrames"]);
        if (!["normal", "return", "throw", "break", "continue"].includes(String(completion.kind)) || typeof completion.hasValue !== "boolean")
          throw new TypeError("Invalid finally completion.");
        if (Object.hasOwn(completion, "nodeId") && integer(completion.nodeId) < 1) throw new TypeError("Invalid completion node identity.");
        if (Object.hasOwn(completion, "label") && typeof completion.label !== "string") throw new TypeError("Invalid completion label.");
        if (Object.hasOwn(completion, "stackFrames") && array(completion.stackFrames).some(value => typeof value !== "string")) throw new TypeError("Invalid completion stack.");
      }
    }
    if (Object.hasOwn(node, "yieldNodeId") && integer(node.yieldNodeId) < 1) throw new TypeError("Invalid generator yield identity.");
    if (node.state === "suspended" && (!Object.hasOwn(node, "yieldNodeId") || !Object.hasOwn(node, "suspendedScope"))) throw new TypeError("Missing suspended generator state.");
    for (const rawCompletion of array(node.sent)) {
      const completion = record(rawCompletion);
      fields(completion, ["type", "value"]);
      if (!["normal", "return", "throw"].includes(String(completion.type))) throw new TypeError("Invalid generator completion type.");
    }
    if (Object.hasOwn(node, "environment")) {
      const environment = record(node.environment);
      fields(environment, [], ["homeObject", "newTarget", "construction", "classInitializer"]);
      if (environment.classInitializer !== undefined && (environment.classInitializer !== true || !Object.hasOwn(environment, "homeObject")))
        throw new TypeError("Invalid class initializer environment.");
      if (Object.hasOwn(environment, "homeObject")) reference(environment.homeObject);
      if (Object.hasOwn(environment, "newTarget")) callable(environment.newTarget);
      if (Object.hasOwn(environment, "construction")) reference(environment.construction, ["construction-environment"]);
    }
  } else {
    fields(node, ["kind", "parent", "importMeta", "functionBoundary", "chargeData", "bindings", "cells"], ["restoredBindings", "privateNames", "resourceState", "objectEnvironment", "withObject", "moduleEnvironment", "globalEnvironment", "simpleCatchParameter"]);
    if (node.simpleCatchParameter !== undefined) {
      const bindings = array(node.bindings);
      const cells = array(node.cells);
      const binding = bindings.length === 1 ? array(bindings[0]) : [];
      const cell = cells.length === 1 ? record(cells[0]) : {};
      if (typeof node.simpleCatchParameter !== "string" || node.simpleCatchParameter.length === 0 ||
          absent(node.parent) || node.functionBoundary !== false || node.globalEnvironment === true ||
          node.withObject !== undefined || node.objectEnvironment !== undefined ||
          binding[0] !== node.simpleCatchParameter || binding[1] !== 0 || cell.kind !== "let")
        throw new TypeError("Invalid simple catch parameter scope.");
    }
    if (node.globalEnvironment !== undefined && typeof node.globalEnvironment !== "boolean")
      throw new TypeError("Invalid global environment flag.");
    if (node.moduleEnvironment !== undefined) {
      const environment = record(node.moduleEnvironment);
      fields(environment,["available","namespaces"]);
      const available = array(environment.available);
      if (available.some(name=>typeof name !== "string") || new Set(available).size !== available.length)
        throw new TypeError("Invalid module environment names.");
      const namespaces = reference(environment.namespaces,["object"]);
      fields(namespaces,["kind","entries"],["sandboxNullPrototype"]);
      for (const namespace of Object.values(record(namespaces.entries))) reference(namespace,["module-namespace"]);
    }
    if (node.objectEnvironment !== undefined) {
      if (!absent(node.parent)) throw new TypeError("Only root scopes own global object environments.");
      const globalObject = reference(node.objectEnvironment, ["intrinsic"]);
      if (globalObject.id !== '["globalThis"]') throw new TypeError("Invalid global object environment.");
    }
    if (node.withObject !== undefined) {
      if (absent(node.parent) || node.functionBoundary !== false || node.globalEnvironment === true ||
        node.objectEnvironment !== undefined) throw new TypeError("Invalid with scope frame.");
      const object = reference(node.withObject);
      if (["scope-frame", "guest-source", "guest-script", "construction-environment", "thenable-state", "symbol"].includes(String(object.kind)))
        throw new TypeError("Invalid with object reference.");
    }
    if (node.resourceState !== undefined) reference(node.resourceState, ["object"]);
    if (node.privateNames !== undefined) {
      const names = new Set<string>();
      for (const raw of array(node.privateNames)) {
        const entry = array(raw);
        if (entry.length !== 2 || typeof entry[0] !== "string" || names.has(entry[0])) throw new TypeError("Invalid private-name scope.");
        names.add(entry[0]);
        privateIdentity(entry[1], entry[0]);
      }
    }
    if (!absent(node.parent)) reference(node.parent, ["scope-frame"]);
    if (typeof node.functionBoundary !== "boolean" || typeof node.chargeData !== "boolean") throw new TypeError("Invalid guest frame flags.");
    const cells = array(node.cells);
    for (const rawCell of cells) {
      const cell = record(rawCell);
      if (typeof cell.initialized !== "boolean" || !["var", "let", "const"].includes(String(cell.kind))) throw new TypeError("Invalid guest binding cell.");
      fields(cell, cell.initialized ? ["kind", "initialized", "value"] : ["kind", "initialized"], ["silentImmutable", "deletable"]);
      if (cell.deletable !== undefined &&
          (cell.deletable !== true || cell.kind !== "var" || cell.initialized !== true))
        throw new TypeError("Invalid deletable binding cell.");
      if (cell.silentImmutable !== undefined) {
        if (cell.silentImmutable !== true || cell.kind !== "const" || cell.initialized !== true ||
            node.functionBoundary !== false || cells.length !== 1 ||
            array(node.bindings).length !== 1 ||
            reference(reference(cell.value, ["guest-function"]).scope, ["scope-frame"]) !== node)
          throw new TypeError("Invalid named function binding cell.");
      }
    }
    const names = new Set<string>();
    const used = new Set<number>();
    for (const rawBinding of array(node.bindings)) {
      const binding = array(rawBinding);
      if (binding.length !== 2 || typeof binding[0] !== "string" || names.has(binding[0])) throw new TypeError("Invalid guest binding name.");
      const id = integer(binding[1]);
      if (id >= cells.length) throw new TypeError("Unknown guest binding cell.");
      names.add(binding[0]); used.add(id);
    }
    if (used.size !== cells.length) throw new TypeError("Unreferenced guest binding cell.");
    if (Object.hasOwn(node, "restoredBindings")) {
      if (!absent(node.parent)) throw new TypeError("Only root scopes own pending restored bindings.");
      const restoredNames = new Set<string>();
      for (const rawBinding of array(node.restoredBindings)) {
        const binding = array(rawBinding);
        if (binding.length !== 2 || typeof binding[0] !== "string" || restoredNames.has(binding[0])) throw new TypeError("Invalid restored binding.");
        restoredNames.add(binding[0]);
      }
    }
  }
  return true;
}

export function validateGuestHeapGraphs(heap: Record<string, unknown>): void {
  for (const [kind, edge, message] of [
    ["scope-frame", "parent", "Cyclic guest scope parent graph."],
    ["promise-reaction", "source", "Cyclic promise reaction source graph."]
  ] as const) {
    const finished = new Set<string>();
    for (const [id, raw] of Object.entries(heap)) {
      if (record(raw).kind !== kind || finished.has(id)) continue;
      const path = new Set<string>();
      let current: string | undefined = id;
      while (current !== undefined && !finished.has(current)) {
        if (path.has(current)) throw new TypeError(message);
        const node = record(heap[current]);
        if (node.kind !== kind) break;
        path.add(current);
        const parent: unknown = node[edge];
        current = absent(parent) ? undefined : String(record(parent).id);
      }
      for (const visited of path) finished.add(visited);
    }
  }
}
