# Issue #606: runtime-compatible npm for Node 18 smoke tests

## Verified failure

Toolcraft workflow 33891796962, job 101084976213, starts with Node 18.18.0
and npm 9.8.1. After dependency installation, nested npm pack resolves npm
11.19.1 from the workspace tooling and fails with tracingChannel missing.
The log explicitly reports that npm 11.19.1 does not support Node 18.18.0.
The separate HTTP package publication succeeded at version 0.1.12.

## Fix

In only the Node 18.18.0 compatibility job, install npm 9.8.1 locally without
saving a manifest or lockfile change and without running lifecycle scripts.
This matches the npm version supplied by that pinned Node runtime and ensures
nested npm invocations find a compatible CLI. Keep the entire runtime matrix,
all smoke checks, and the separate modern OIDC publishing environment unchanged.

## Verification

Run the maintained workflow lint route and diff checks. Do not add workflow unit
tests. Push only this workflow and plan, verify remote delivery, and use the actual
GitHub matrix/publication result to establish the release fix. Local static checks
alone do not prove the Node 18 smoke bundle or downstream publication succeeds.
