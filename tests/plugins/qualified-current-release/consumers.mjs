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
];

export const archiveTests = ["tests/commands/archive/native.test.ts", "tests/commands/archive-stress/pax-independent/controls.test.ts"];
export const archiveInputs = [...archiveTests, "tests/commands/archive/helpers.ts", "tests/commands/archive-stress/pax-independent/fixtures.ts"];
export const ownerPath = "tests/plugins/qualified-current-release";
