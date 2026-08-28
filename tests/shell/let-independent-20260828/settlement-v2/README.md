# Settlement manifest correction v2

The first normal child was correctly refused before any product import because
the new supplementary manifest omitted the frozen worker baseline and holdouts
fields. Its exit1/raw admission failure and removed scratch remain in
settlement-results-actual-package-01. V2 supplies exactly those existing required
values; unchanged worker/load guard/classifier/late-exit wrapper and package.
No guard is disabled or missing-field admission treated as behavior acceptance.
