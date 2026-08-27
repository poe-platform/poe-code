const group = (name, directory, files, runtime, existingCoverage, qualification = "unchanged public consumer; strict declarations and emitted runtime") => ({ name, files: files.map(file => `${directory}/${file}`), runtime, existingCoverage, qualification });

export const consumerGroups = [
  group("regex", "tests/commands/regex-execution", ["package-consumer.mts"], ["package-consumer.mjs"], "tests/commands/regex-execution/package.mjs"),
  group("regex-continuation", "tests/commands/regex-execution/continuation", ["package-consumer.mts"], ["package-consumer.mjs"], "tests/commands/regex-execution/continuation/package.mjs"),
  group("regex-followup", "tests/commands/regex-execution/followup", ["product-consumer.mts"], ["product-consumer.mjs"], "tests/commands/regex-execution/followup/package.mjs"),
  group("regex-production", "tests/stress/regex-execution/production-review", ["package-consumer.mts"], ["package-consumer.mjs"], "tests/stress/regex-execution/production-review/package.mjs"),
  group("regex-production-continuation", "tests/stress/regex-execution/production-continuation-review", ["package-consumer.mts"], ["package-consumer.mjs"], "tests/stress/regex-execution/production-continuation-review/package.mjs"),
  group("s3-constructor", "tests/fs/s3/constructor-comparison", ["consumer.mts"], ["consumer.mjs"], "tests/fs/s3/constructor-comparison/build-consumer.mjs"),
  group("s3-http-author", "tests/fs/s3/http/author", ["public-consumer.mts"], ["public-consumer.mjs"], "tests/fs/s3/http/author/build-public-consumer.mjs", "strict public types and module import only; exported workflow requires explicit real S3 service/credentials; no service execution claimed"),
  group("s3-http-independent", "tests/fs/s3/http-independent", ["public-workflow.mts"], ["public-workflow.mjs"], "tests/fs/s3/http-independent/validate.mjs", "strict public types and module import only; exported workflow requires explicit real S3 service/credentials; no service execution claimed"),
  group("s3-rmdir", "tests/fs/s3/rmdir-independent", ["public-consumer.mts"], ["public-consumer.mjs"], "tests/fs/s3/rmdir-independent/run.mjs", "strict public types and constructor smoke only; not independent rmdir or MinIO acceptance"),
  group("webdav-loopback", "tests/fs/webdav/consumer", ["consumer.test.mts", "example.mts", "provider.mts", "types.mts"], ["consumer.test.mjs"], "tests/fs/webdav/consumer/run.mjs", "strict public types including type assertions; unchanged thirteen serialized loopback runtime tests; not deployed-provider proof"),
  {
    name: "webdav-services",
    files: ["tests/fs/webdav/real-service/consumer.mts", "tests/fs/webdav/real-service/example.mts", "tests/fs/webdav/real-service/https.mts", "tests/fs/webdav/real-service/phase2-consumer.mts", "tests/fs/webdav/real-service-independent/independent.mts", "tests/fs/webdav/real-service-independent/scope-neighbors.mts", "tests/fs/webdav/rmdir-real-service/feasibility.mts"],
    runtime: [],
    existingCoverage: "tests/fs/webdav/real-service/run.mjs; tests/fs/webdav/real-service/scope-replay.mjs; tests/fs/webdav/real-service-independent/run.mjs; tests/fs/webdav/rmdir-real-service/run.mjs",
    qualification: "strict compile of current provider/research programs with unchanged shared example/https companions, assembled as existing runners do; runtime requires explicit provisioned Apache/WsgiDAV TLS/backing authority; not executed or counted as provider passes; feasibility is research, not product rmdir support",
  },
  group("stream-inspection", "tests/integration/stream-inspection-public-author", ["consumer.mts"], ["consumer.mjs"], "tests/integration/stream-inspection-public-author/verify.mjs"),
  group("stream-five", "tests/plugins/stream-five-fixture-migration", ["public-options.mts"], ["public-options.mjs"], "tests/plugins/stream-five-fixture-migration/capture.mjs final"),
  group("time-env-public", "tests/commands/time-env-stress/fraction-independent/packed", ["public-positive.mts"], ["public-positive.mjs"], "tests/commands/time-env-stress/fraction-independent/packed/verify.mjs"),
  { ...group("time-env-leaf", "tests/commands/time-env-stress/fraction-independent/packed", ["leaf-positive.mts"], ["leaf-positive.mjs"], "tests/commands/time-env-stress/fraction-independent/packed/verify.mjs", "maintained internal packed leaf types and factory construction; not export-map acceptance"), localPackage: true },
  group("webdav-atomic", "tests/fs/webdav/atomic-extension", ["consumer.mts", "example.mts", "https.mts"], [], "tests/fs/webdav/atomic-extension/run.mjs", "strict current public declarations only; runtime requires explicit TLS service and backing authority; no deployed-provider pass"),
  { ...group("webdav-atomic-independent", "tests/fs/webdav/atomic-extension-independent", ["consumer.mts"], ["consumer.mjs"], "tests/fs/webdav/atomic-extension-independent/run.mjs", "unchanged service-free injected-fetch runtime; configured removal and stock refusal, not real TLS/provider acceptance"), consumerIdentity: true },
  { ...group("webdav-timestamp-independent", "tests/fs/webdav/release-timestamp-independent", ["independent.test.mts"], ["independent.test.mjs"], "tests/fs/webdav/release-timestamp-independent/run.mjs", "current loopback runtime:20 controls plus3 mutant kills, not23 provider successes"), companions: ["tests/fs/webdav/consumer/provider.mts"], nodeTests: 23 },
];

export const negativeGroups = [
  { name: "time-env-public-negative", path: "tests/commands/time-env-stress/fraction-independent/packed/public-negative.mts", expected: "tests/commands/time-env-stress/fraction-independent/packed/evidence-final/public-negative-types.stdout", positive: "time-env-public", diagnostics: 2 },
  { name: "time-env-leaf-negative", path: "tests/commands/time-env-stress/fraction-independent/packed/leaf-negative.mts", expected: "tests/commands/time-env-stress/fraction-independent/packed/evidence-final/internal-leaf-negative-types.stdout", positive: "time-env-leaf", diagnostics: 5 },
];

export const currentConsumerPaths = () => [...new Set(consumerGroups.flatMap(group => [...group.files, ...group.companions ?? []]))];
export const archiveTests = ["tests/commands/archive/native.test.ts", "tests/commands/archive-stress/pax-independent/controls.test.ts"];
export const archiveInputs = [...archiveTests, "tests/commands/archive/helpers.ts", "tests/commands/archive-stress/pax-independent/fixtures.ts"];
export const ownerPath = "tests/plugins/qualified-current-release";
