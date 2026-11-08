export const wellKnownSymbols: Readonly<Record<string, symbol>> = Object.freeze({
  iterator: Symbol.iterator,
  asyncIterator: Symbol.asyncIterator,
  dispose: Symbol.dispose ?? Symbol.for("nodejs.dispose"),
  asyncDispose: Symbol.asyncDispose ?? Symbol.for("nodejs.asyncDispose"),
  hasInstance: Symbol.hasInstance,
  isConcatSpreadable: Symbol.isConcatSpreadable,
  match: Symbol.match,
  matchAll: Symbol.matchAll,
  replace: Symbol.replace,
  search: Symbol.search,
  species: Symbol.species,
  split: Symbol.split,
  toPrimitive: Symbol.toPrimitive,
  toStringTag: Symbol.toStringTag,
  unscopables: Symbol.unscopables
});
