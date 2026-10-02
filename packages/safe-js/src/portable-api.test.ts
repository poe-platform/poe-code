import { expect, it } from "vitest";
import * as core from "./core.js";
import * as workerd from "./workerd.js";
import * as node from "./index.js";

it.each([core, workerd, node])("exposes the complete portable API", api => {
  for (const name of ["run", "createRealm", "defineExtension", "dump", "restore", "parse",
    "parseModule", "parseSourceModule", "lint", "deepCopyFromSandbox", "deepCopyToSandbox",
    "Budget", "SandboxError", "SnapshotValidationError", "declareHostOperation", "captureHostContext", "makeFsModule",
    "makeEnvModule", "makeFailModule", "makeLogModule", "makeMetricModule", "makeTimeModule",
    "createRootedSourceResolver", "captureHostContext"]) {
    expect(Reflect.get(api, name), name).toBeTypeOf("function");
  }
});
