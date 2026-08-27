import { closeSync, openSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const caseId = process.env.LOAD_AUTH_CASE_ID;
const loaderPath = process.env.LOAD_AUTH_LOADER_PATH;
const recordPath = process.env.LOAD_AUTH_RECORD_PATH;
const packageRoot = process.env.LOAD_AUTH_PACKAGE_ROOT;
const targetsText = process.env.LOAD_AUTH_TARGETS;

if (!caseId || !loaderPath || !recordPath || !packageRoot || !targetsText) {
  throw new Error("load-auth bootstrap requires complete explicit configuration");
}
if (!/^[a-z0-9][a-z0-9-]*$/u.test(caseId)) {
  throw new Error(`invalid load-auth case id: ${caseId}`);
}

const targets = JSON.parse(targetsText);
if (!Array.isArray(targets) || targets.length < 1 || targets.length > 16) {
  throw new Error("load-auth bootstrap requires 1..16 declared targets");
}

closeSync(openSync(recordPath, "wx"));
register(pathToFileURL(loaderPath), {
  parentURL: import.meta.url,
  data: { caseId, recordPath, packageRoot, targets, maxRecords: 16, maxRecordBytes: 65536 },
});

