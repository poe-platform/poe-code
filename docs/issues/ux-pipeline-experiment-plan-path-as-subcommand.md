# UX: plan-path listed as action subcommand alongside run/init/validate/install

## Summary

Both `pipeline --help` and `experiment --help` list `plan-path` as a sibling of action-verb subcommands (`run`, `init`, `validate`, `install`, `journal`). `plan-path` is a utility query (it prints a directory path), not an action — mixing it with action verbs makes the Commands list incoherent.

## Evidence

`pipeline --help` Commands:
```
run [options]      Run the selected pipeline plan
init [options]     Create a new pipeline plan
validate [options] Validate a pipeline plan
install [options]  Install the Pipeline skill
plan-path          Print the directory where pipeline plan files should be placed
```

`experiment --help` Commands:
```
run [options] [doc]      Run an experiment doc
journal [doc]            Display the experiment journal
validate [doc]           Validate an experiment doc
plan-path                Print the directory where experiment plan files should be placed
install [options]        Install the Experiment skill
```

`plan-path` has no verb prefix and no `[options]`/`[doc]` suffix — it reads as a noun/path, not a command.

## Why it matters

New users see a list of action verbs and then a dangling noun. It is unclear whether `plan-path` is a subcommand, a placeholder, or a required argument.

## Suggested direction

Either rename to a verb form (`show-plan-path`, `print-plan-dir`) or move it to a separate "Utilities:" section in the help output to visually separate query commands from action commands.

## Severity

Low–Medium

## Area

Pipeline / Experiment / help / naming
