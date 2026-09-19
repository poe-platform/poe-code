import { describe, expect, it } from "vitest";
import { PythonSession } from "./index.js";

function session() {
  return new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
}
function scalar(s: PythonSession, source: string) {
  const result = s.eval(source);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw Error("guest evaluation failed");
  return result.value.primitive;
}

describe("session-owned object and library bridge", () => {
  it("registers an owned module alias with shared identity and live mutations", () => {
    const s = session(), namespace = s.createNamespace();
    namespace.set("answer", s.value(42n));
    const module = s.registerModule("canonical", namespace);
    expect(s.registerModuleAlias("alias", module)).toBe(module);
    expect(s.exec("import canonical,alias\nalias.answer=43")).toEqual({ status: "ok" });
    expect(scalar(s, "canonical is alias")).toBe(true);
    expect(scalar(s, "canonical.answer")).toBe(43n);
    expect(() => s.registerModuleAlias("alias", module)).toThrow("already registered");
    expect(() => s.registerModuleAlias("", module)).toThrow("module name");
    const foreign = session();
    expect(() => s.registerModuleAlias("foreign", foreign.registerModule("other", foreign.createNamespace()))).toThrow("different session");
    expect(() => s.registerModuleAlias("invalid", s.value(1n))).toThrow("registered module");
    s.close();
    expect(() => s.registerModuleAlias("closed", module)).toThrow("closed");
  });
  it("invokes explicitly injected synchronous callables with owned arguments", () => {
    const s = session(), calls: string[] = [];
    s.globals.set("read", s.callable(args => {
      expect(Object.isFrozen(args)).toBe(true);
      calls.push(String(args[0]!.primitive));
      expect(() => s.eval("1")).toThrow("running");
      expect(() => s.globals.get("read")).toThrow("running");
      return s.list([s.value("parsed"), args[0]!]);
    }));
    expect(scalar(s, "read('line')[1]")).toBe("line");
    expect(calls).toEqual(["line"]);
    expect(s.exec("read(line='x')")).toMatchObject({ status: "exception" });
    expect(calls).toEqual(["line"]);
  });

  it("rejects asynchronous and foreign callback results", () => {
    const asyncSession = session();
    asyncSession.globals.set("read", asyncSession.callable((async () => asyncSession.value(null)) as never));
    expect(asyncSession.eval("read()")).toMatchObject({ status: "terminated", reason: "capability" });
    const s = session(), foreign = session().value(null);
    s.globals.set("read", s.callable(() => foreign));
    expect(s.eval("read()")).toMatchObject({ status: "terminated" });
  });

  it("preserves an outer bridge callback across nested guest hashing services", () => {
    const s = session(), calls: string[] = [];
    s.globals.set("hash_service", s.callable(() => {
      calls.push("inner");
      expect(() => s.eval("1")).toThrow("running");
      return s.value(7n);
    }));
    expect(s.exec("class Key:\n def __hash__(self):return hash_service()\nkey=Key()")).toEqual({ status: "ok" });
    s.globals.set("outer", s.callable(args => {
      const mapping = s.dictionary([[args[0]!, s.value("stored")]]);
      calls.push("outer-resumed");
      expect(args[0]!.kind).toBe("instance");
      expect(() => s.globals.get("key")).toThrow("running");
      return s.list([mapping, s.value("resumed")]);
    }));
    expect(scalar(s, "outer(key)[1]")).toBe("resumed");
    expect(calls).toEqual(["inner", "outer-resumed"]);
    expect(scalar(s, "1+1")).toBe(2n);
  });

  it("preserves cancellation through a throwing injected callable", () => {
    const controller = new AbortController();
    const s = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n], signal: controller.signal });
    s.globals.set("read", s.callable(() => {
      controller.abort();
      throw Error("host read failed");
    }));
    expect(s.eval("read()")).toMatchObject({ status: "terminated", reason: "cancelled" });
    expect(s.eval("1")).toMatchObject({ status: "terminated", reason: "cancelled" });
  });

  it("constructs mutable guest containers without sharing host arrays", () => {
    const s = session();
    const inputs = [s.value("name"), s.value("value")];
    const row = s.list(inputs);
    inputs.pop();
    const mapping = s.dictionary([[s.value("row"), row]]);
    s.globals.set("data", mapping);
    expect(scalar(s, "data['row'][1]")).toBe("value");
    expect(s.exec("data['row'].append('tail')")).toEqual({ status: "ok" });
    expect(scalar(s, "len(data['row'])")).toBe(3n);
    s.globals.set("names", s.tuple([s.value("first"), s.value("second")]));
    expect(scalar(s, "names[1]")).toBe("second");
    expect(s.exec("names[0]='changed'")).toMatchObject({ status: "exception" });
    expect(() => mapping.primitive).toThrow("not a primitive");
  });

  it("rejects foreign handles and invalidates all access after close", () => {
    const s = session(), foreign = session().value("foreign");
    expect(() => s.list([foreign])).toThrow("different session");
    expect(() => s.tuple([foreign])).toThrow("different session");
    expect(() => s.dictionary([[s.value("key"), foreign]])).toThrow("different session");
    const row = s.list([]);
    s.close();
    expect(() => row.kind).toThrow("closed");
    expect(() => s.list([])).toThrow("closed");
  });

  it("installs source-defined libraries as scoped real guest modules", () => {
    const s = session(), library = s.createNamespace();
    library.set("__name__", s.value("example"));
    expect(s.exec("class Reader:\n def __init__(self,rows):self.rows=iter(rows)\n def __iter__(self):return self\n def __next__(self):return next(self.rows)", { globals: library })).toEqual({ status: "ok" });
    const module = s.registerModule("example", library);
    s.globals.set("example", module);
    s.globals.set("rows", s.list([s.list([s.value("first")]), s.list([s.value("second")])]));
    expect(s.exec("from example import Reader\nreader=Reader(rows)")).toEqual({ status: "ok" });
    expect(scalar(s, "next(reader)[0]")).toBe("first");
    expect(scalar(s, "next(reader)[0]")).toBe("second");
    expect(s.exec("next(reader)")).toMatchObject({ status: "exception" });
    expect(scalar(s, "type(example).__name__")).toBe("module");
    library.set("added", s.value(42n));
    expect(scalar(s, "example.added")).toBe(42n);
    expect(s.exec("example.added=43")).toEqual({ status: "ok" });
    expect(library.get("added")?.primitive).toBe(43n);
    expect(session().exec("import example")).toMatchObject({ status: "exception" });
    expect(s.globals.get("Reader")).toBe(library.get("Reader"));
  });

  it("rejects foreign namespaces and accidental module replacement", () => {
    const s = session();
    expect(() => s.registerModule("foreign", session().createNamespace())).toThrow("different session");
    s.registerModule("example", s.createNamespace());
    expect(() => s.registerModule("example", s.createNamespace())).toThrow("already registered");
    expect(() => s.registerModule("", s.createNamespace())).toThrow("module name");
  });
});
