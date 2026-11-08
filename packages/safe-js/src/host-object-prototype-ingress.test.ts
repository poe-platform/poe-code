import { afterEach, expect, it } from "vitest";
import { Budget, createRealm, defineExtension, type HostObject } from "./core.js";

const realms: ReturnType<typeof createRealm>[] = [];
afterEach(async () => {
  for (const realm of realms.splice(0)) await realm.close();
});

function fixture(dataSize = 20000) {
  const budget = new Budget({ dataSize });
  let host!: HostObject;
  const realm = createRealm({
    budget,
    grants: ["guest:retain"],
    extensions: [
      defineExtension({
        manifest: {
          version: 1,
          name: "prototype-ingress",
          globals: ["install", "direct", "wrapped", "directAsync", "wrappedAsync", "fresh"],
          capabilities: ["guest:retain"]
        },
        setup(owner) {
          host = owner.createHostObject({
            expandos: { maxKeys: 8, maxKeyCodeUnits: 128 },
            properties: { native: { get: () => 42 } }
          });
          const install = owner.retainGuestArguments((prototype: unknown) => {
            try {
              owner.setHostObjectPrototype(host, prototype);
            } finally {
              owner.releaseGuestReference(prototype);
            }
          }, 0);
          return {
            globals: {
              install,
              direct: () => host,
              wrapped: () => ({ node: host, marker: "new" }),
              directAsync: () => Promise.resolve(host),
              wrappedAsync: () => Promise.resolve({ node: host, marker: "new" }),
              fresh: () => ({ node: host, payload: "x".repeat(5000) })
            }
          };
        }
      })
    ]
  });
  realms.push(realm);
  return { realm, budget };
}

it.each([
  ["direct", "value.native", ""],
  ["wrapped", "value.node.native", ""],
  ["directAsync", "value.native", "await "],
  ["wrappedAsync", "value.node.native", "await "]
])(
  "does not charge the owned prototype graph again for held %s results",
  async (operation, read, prefix) => {
    const { realm, budget } = fixture();
    expect(await realm.evaluate('install({payload:"x".repeat(8192)});return 1')).toMatchObject({
      ok: true
    });
    const release = budget.deferReconciliation();
    try {
      expect(
        await realm.evaluate(
          `let total=0;for(let i=0;i<20;i++){let value=${prefix}${operation}();total+=${read}}return total`
        )
      ).toMatchObject({ ok: true, returnValue: 840 });
      expect(budget.currentDataSize).toBeLessThan(20000);
    } finally {
      release();
    }
  }
);

it("still charges new data copied around an owned linked capability", async () => {
  const { realm, budget } = fixture();
  expect(await realm.evaluate('install({payload:"x".repeat(8192)});return 1')).toMatchObject({
    ok: true
  });
  const release = budget.deferReconciliation();
  try {
    expect(
      await realm
        .evaluate("for(let i=0;i<5;i++)fresh();return 1")
        .catch((error) => ({ ok: false, error }))
    ).toMatchObject({
      ok: false,
      error: { code: "budgetExceeded", budget: "dataSize" }
    });
  } finally {
    release();
  }
});

it("still enforces the mutable primary prototype graph during held calls", async () => {
  const { realm, budget } = fixture();
  expect(await realm.evaluate('install({payload:"x".repeat(8192)});return 1')).toMatchObject({
    ok: true
  });
  const release = budget.deferReconciliation();
  try {
    expect(await realm.evaluate("for(let i=0;i<10;i++)direct();return 1")).toMatchObject({
      ok: true
    });
    expect(
      await realm
        .evaluate(
          'try{Object.getPrototypeOf(direct()).payload="x".repeat(21000)}catch(error){}return 1'
        )
        .catch((error) => ({ ok: false, error }))
    ).toMatchObject({
      ok: false,
      error: { code: "budgetExceeded", budget: "dataSize" }
    });
  } finally {
    release();
  }
});

it("still charges a linked capability's own expando graph on ingress", async () => {
  const { realm, budget } = fixture(40000);
  expect(
    await realm.evaluate(
      'install({payload:"x".repeat(8192)});direct().ownPayload="x".repeat(8192);return 1'
    )
  ).toMatchObject({ ok: true });
  const release = budget.deferReconciliation();
  try {
    expect(
      await realm
        .evaluate("for(let i=0;i<4;i++)direct();return 1")
        .catch((error) => ({ ok: false, error }))
    ).toMatchObject({
      ok: false,
      error: { code: "budgetExceeded", budget: "dataSize" }
    });
  } finally {
    release();
  }
});
