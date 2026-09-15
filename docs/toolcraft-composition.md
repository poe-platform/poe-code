# Toolcraft definition copies

Use `cloneCommandNode` when copying an existing command or group definition. Spreading a materialized node and calling a definition builder again does not preserve every part of its definition.

```ts
import { cloneCommandNode } from "toolcraft";
import { createSDK } from "toolcraft/sdk";

const copiedRoot = cloneCommandNode(root);
const sdk = createSDK(copiedRoot);
```

The example assumes an existing `root` group. The returned tree has independent node objects and preserves normal SDK type inference. It retains command source locations, proxy transport/filter/rename settings, stream definitions, and default-child references. Current manual descendants are included even when a tree has been assembled incrementally.

## Inheritance and ownership

The copied root retains its effective inherited configuration, so detaching a command or subgroup does not discard its existing preflights. Descendants retain their own definitions; inherited checks are applied once when the tree is rebuilt, rather than repeatedly treating resolved parent checks as new child checks.

Function and schema identities remain shared. Mutable metadata follows the existing builders' copy rules; this is not a deep clone of arbitrary application state. Additional runtime properties are not part of the returned definition contract. `ClonedCommandNode` reflects that boundary in its return type.

An optional second argument replaces the scope throughout the copy:

```ts
const cliOnly = cloneCommandNode(root, ["cli"]);
```

An explicit empty array keeps every node outside all surfaces. A scope override returns the general command-node type instead of retaining static scope information that no longer describes the copy.

## MCP proxy definitions

Copying a proxy-owned tree excludes runtime-generated proxy descendants and does not copy its live connection. Its new owner resolves the retained proxy definition and opens its own connection. Manual descendants remain available; allowlists and renames are preserved for rediscovery. Finish and dispose each owner's connections according to `docs/toolcraft-results.md`.

A proxy handler explicitly selected outside a proxy-owned tree remains an ordinary copied function reference. Copying arbitrary functions does not duplicate resources captured in their closures.

## OpenAPI client composition

`defineClient` uses the shared definition-copy operation. This preserves source-relative fixture lookup and avoids repeated inherited preflights. It also preserves standalone, nested, handwritten-only, and proxy-first group declarations.

Same-path group merging is a separate boundary: an incoming proxy definition is still lost when an ordinary generated group with that name exists first. This remains tracked under TC-022; definition copying alone does not establish a merge policy for multiple upstream configurations or their metadata.
