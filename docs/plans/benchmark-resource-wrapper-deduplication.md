# Keep benchmark aggregation outside test discovery

The diagnostic-profile resource wrapper imports lifecycle, process and pattern
test files that the normal suite already discovers individually. Its location
under `tests` therefore repeats the same resource probes in every release.

Move that import-only wrapper to the adjacent benchmark directory and update the
benchmark entry point. Keep the three canonical test owners and their assertions
unchanged. The benchmark still launches one process per diagnostic profile with
the existing serial settings. Historical evidence stays untouched.

Validation: normal discovery drops only the wrapper, from 612 to 611 files. Each
of the two benchmark profiles retains the identical 38 passing cases, and the
three independent owners pass all 38 cases. The eliminated duplicate invocation
took 32.33 seconds locally. No product code, test selection policy, assertion,
timeout or concurrency changes.
