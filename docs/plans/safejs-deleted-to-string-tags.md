# Deleted collection and typed-array tags

Four native controls fail before repair: deleting Map, Set, Uint8Array and
Float32Array prototype tags still leaves synthetic names in Object.toString.
Four unchanged-tag controls pass. Remove the three synthetic fallback branches
and the now-unused typed-array import. Installed tags keep supplying names;
deletion falls back to Object as native JavaScript does.

Check deletion recovery, unchanged tags, existing Promise compatibility,
typed-array and collection behavior, TypeScript and lint. Do not change fixtures,
deadlines, or compatibility switches. This followup is not included in the
completed 22,217-pass/one-failure dynamic candidate run.

The repair passes 39 deletion/control, Promise compatibility and unchanged
camera tests, plus 15 snapshot, realm-free prototype and Promise-tag tests.
TypeScript and focused lint pass. The full candidate's separate
namespace timeout passes all 18 cases in isolation without changing assertions
or its five-second timeout; the complete run remains failed.
