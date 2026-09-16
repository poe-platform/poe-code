# Independent chart graph review

`chart-model-review.test.ts` adds original input/output assertions independently
of the graph implementation owner. Tests use small inline XML trees, with no
files or reference dependencies. They validate chart-owned solid/no-fill/line
color behavior in both dialects, reject duplicate numeric and category indices,
prevent a deleted series handle from addressing its shifted neighbor, exercise
chart-bound gradient stop XML writes, inspect defaults without creating XML,
roundtrip title text frames in both dialects, traverse sparse category levels,
check inherited category membership and exercise numeric collection lookup.

The first eight cases exposed six failures: solid sentinel treated as RGB, wrong
no-fill mapping (subsequent assertion), duplicate numeric/category indices,
shifted series identity and mismatched full/subtree XML owners. Two additional
cases exposed category equality loss during membership and absent numeric
indexing. Failures were delivered to the graph owner before fixes. The scalar
reads and title text roundtrip passed originally; hierarchical label expansion
also passed before membership was fixed. Final rerun results are recorded by the
parent delivery receipt rather than counting the initial failures as passes.

Final schema/setter review adds `chart-object-schema-boundary.test.ts`: 18
original assertions for schema/runtime agreement. Nine invalid inputs initially
passed admission despite setter rejection: legend offsets beyond [-1,1],
nonpositive major/minor units, CUSTOM legend position and MIXED label positions.
Nine valid inputs retain boundary/null semantics, including the documented
CUSTOM axis crossing assignment. The owning root delegate fixes those field
constraints. The font validator independently rejects nesting past its 64-object
bound; a 100-level original regression confirms it never invokes a deep accessor.
