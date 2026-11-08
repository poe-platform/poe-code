import { expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { parseMetafile } from "../model.js";
import { runRules } from "./index.js";

it("reports portable artifact violations through the registered build policy", async () => {
  const model = await makeWorkspace({ "/repo/package.json": pkgJson({ name: "root", private: true }) });
  const build = { ...parseMetafile({}), portableRuntime: [{ package: "safe-bash-command-example", file: "packages/safe-bash-command-example/dist/index.js", reason: "ambient-buffer" as const }] };
  expect(runRules(model, build, ["portable-runtime"]).violations).toContainEqual(expect.objectContaining({ rule: "portable-runtime", package: "safe-bash-command-example", severity: "error" }));
  expect(runRules(model, undefined, ["portable-runtime"]).skipped).toContain("portable-runtime");
});
