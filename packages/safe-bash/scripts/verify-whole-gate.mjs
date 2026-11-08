console.error(
  "verify:release:whole is retired; no validation was run.\n" +
  "Use npm run build, npm run test:unit and npm run typecheck, plus committed-archive validation.\n" +
  "See README.md#current-imported-feature-validation for prerequisites and the different protocol coverage.",
);
process.exitCode = 78;
