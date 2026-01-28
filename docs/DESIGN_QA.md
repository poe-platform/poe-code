# Desing QA

## Use screenshots

`npm run screenshot-poe-code -- <command>`

e.g.

`npm run screenshot-poe-code -- --help`

## Task

Run each command through screenshot script
Look at each screenshot
Make sure that all commands are useful, coherent, great user experience for CLI users

Baseline

## Common issues

Commands not using the design language
Commands outputting information that is not useful

## Commands to check

poe-code --help
poe-code configure
poe-code configure --help
poe-code configure claude-code --dry-run --yes --api-key sk-test
poe-code install --help
poe-code spawn --help
poe-code spawn claude "hi" --dry-run
poe-code wrap --help
poe-code test --help
poe-code unconfigure --help
poe-code unconfigure claude --dry-run --yes
poe-code query --help
poe-code login --help
poe-code login --dry-run --yes --api-key sk-test
