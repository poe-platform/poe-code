const proxyNodeSymbol = Symbol("toolcraft.mcpProxyNode");

export function isProxyNode(node: object): boolean {
  return Object.getOwnPropertySymbols(node).some(
    (symbol) => symbol.description === proxyNodeSymbol.description && Reflect.get(node, symbol) === true
  );
}

export function markProxyNode<TNode extends object>(node: TNode): TNode {
  Object.defineProperty(node, proxyNodeSymbol, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
  return node;
}
