# Nested workspace test alias resolution

Source base: `11a7a80571a633cd452fde83a3fd57290fc019a4`, Node 22.23.2 / ICU 78.2.

The new declared `@poe-code/safe-fs/node/filesystem` export could not initialize the maintained filesystem recorder test because the `/node` alias matched first. The concrete module-resolution failure is retained in `integration-resolution-red.log`. Sorting the complete alias map by descending key length resolves nested exports before their parents, while retaining every declared alias and existing source target. No test membership, expected behavior, budget or timeout changes.

The existing recorder, CLI startup, exact root export inventory and bundle-route controls then passed 38 tests (`integration-resolution-green.log`). The separate admission/package-policy selection passed 584 tests. Full gate receipts remain separate. This configuration repair is needed for the new host bridge export and does not create a runtime wrapper.
