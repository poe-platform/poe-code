# Metadata result schema correction

Six original cases in metadata-result-schema.test.ts reproduce schema rejection
of positive affected counts for sanitize, properties.set/remove and
tags.add/set/remove. Each failed before the override and passed afterward.
Metadata read operations retain affected = 0; mutation operations accept only
nonnegative integers, matching actual command envelopes and the shared Office
CLI result contract. No CLI layout, grammar or mutation behavior changed.

Only the owned affected-field override is committed from metadata-schema.ts.
Existing sanitization changes and corrected assertions remain in the working
tree outside this atomic improvement. No downloaded fixtures or host capability
was involved in the schema validation tests.
