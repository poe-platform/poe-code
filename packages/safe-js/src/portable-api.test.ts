import { expect, it } from "vitest";
import * as core from "./core.js";
import * as workerd from "./workerd.js";

it.each([core, workerd])("exposes the complete portable API", api => {
  for (const name of ["run", "createRealm", "defineExtension", "dump", "restore", "parse",
    "parseModule", "parseSourceModule", "lint", "deepCopyFromSandbox", "deepCopyToSandbox",
    "Budget", "SandboxError", "SnapshotValidationError", "declareHostOperation", "makeFsModule",
    "makeEnvModule", "makeFailModule", "makeLogModule", "makeMetricModule", "makeTimeModule",
    "createRootedSourceResolver"]) {
    expect(Reflect.get(api, name), name).toBeTypeOf("function");
  }
});
