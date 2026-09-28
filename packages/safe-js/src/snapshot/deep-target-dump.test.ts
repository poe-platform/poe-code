import { expect, it } from "vitest";
import { createSandboxClosure } from "../interp/values.js";
import { boundFunctionStates } from "../interp/bound-function-state.js";
import { guestProxyStates } from "../interp/guest-proxy.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";

it.each(["bound", "proxy", "mixed"])("dumps a deep %s target graph without host recursion", kind => {
  let target = createSandboxClosure({ call: () => 1 });
  for (let i = 0; i < 4096; i++) {
    const next = createSandboxClosure({ call: () => 1 });
    if (kind === "proxy" || (kind === "mixed" && i % 2 === 0))
      guestProxyStates.set(next, { target, handler: {} });
    else boundFunctionStates.set(next, { target, thisValue: null, args: [] });
    target = next;
  }
  const snapshot = JSON.parse(serializeSafeJSSnapshot({ sourceHash: "deep", saved: target }));
  const nodes = Object.values(snapshot.heap) as Array<{ kind: string }>;
  expect(nodes.filter(node => node.kind === "bound-function" || node.kind === "guest-proxy")).toHaveLength(4096);
});

it.each(["new Proxy(f, {})", "f.bind(null)", "i % 2 ? f.bind(null) : new Proxy(f, {})"])(
  "captures and validates 1500 live targets built with %s", async expression => {
    const source = `let f=()=>1; for(let i=0;i<1500;i++) f=${expression}; Number.prototype.saved=f; await 0; return 1;`;
    const pending = run(source);
    try {
      await pending;
      const snapshot = JSON.parse(await dump(pending));
      const nodes = Object.values(snapshot.heap) as Array<{ kind: string }>;
      expect(nodes.filter(node => node.kind === "bound-function" || node.kind === "guest-proxy")).toHaveLength(1500);
      expect(() => restore(snapshot, { source })).not.toThrow();
    } finally { await pending; }
  }
);
