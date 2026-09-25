The static `src/entity-data.ts` table contains all 2,231 HTML named reference
spellings (including legacy semicolonless forms) from Python 3.9's
`html.entities.html5`. It is Unicode mapping data, not tokenizer/parser source.
Python is a development-only data extraction tool and is never a runtime
capability. No upstream Rust source or parser code was adopted. The package
LICENSE includes the Python license notices, which the safe-bash packer copies
with the private implementation's notices.
