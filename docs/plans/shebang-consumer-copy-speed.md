# Shebang consumer copy speed

The maintained test route and focused rerun reproduced the moved consumer's
10-second timeout while copying every unrelated published workspace artifact.

Move the published shell and filesystem artifacts used by the consumer, keeping
the real public exports and runtime invocation. Avoid copying overlapping roots
more than once. Packaging membership remains covered by dedicated artifact tests.

Validate the moved consumer within its existing timeout, ESLint, and the maintained
test route.
