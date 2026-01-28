# Design Language

Visual reference for poe-code CLI design elements.

This document is auto-generated. Run `npm run generate:design-docs` to regenerate.

## Text Styles

Core text styling functions for consistent CLI output.

### intro

Prominent introductory banners with brand background

```typescript
design.text.intro("Configure")
```

![intro](design-language/intro.png)

### heading

Section headings with brand accent color

```typescript
design.text.heading("Available Commands")
```

![heading](design-language/heading.png)

### section

Bold text for subsection labels

```typescript
design.text.section("Options:")
```

![section](design-language/section.png)

### command

CLI command names in accent color

```typescript
design.text.command("poe-code configure")
```

![command](design-language/command.png)

### argument

Command arguments (dimmed)

```typescript
design.text.argument("<provider>")
```

![argument](design-language/argument.png)

### option

CLI flags and options in yellow

```typescript
design.text.option("--dry-run")
```

![option](design-language/option.png)

### example

Example text (dimmed)

```typescript
design.text.example("$ poe-code configure claude")
```

![example](design-language/example.png)

### usageCommand

Commands in usage examples (green)

```typescript
design.text.usageCommand("npm install -g poe-code")
```

![usageCommand](design-language/usageCommand.png)

### link

Hyperlinks and references

```typescript
design.text.link("https://poe.com")
```

![link](design-language/link.png)

### muted

De-emphasized text

```typescript
design.text.muted("(optional)")
```

![muted](design-language/muted.png)

## Symbols

Status indicators and visual markers.

### info

Information indicator (magenta dot)

```typescript
design.symbols.info  // ●
```

![info](design-language/info.png)

### success

Success indicator (magenta diamond)

```typescript
design.symbols.success  // ◆
```

![success](design-language/success.png)

### resolved

Resolved/completed indicator (hollow diamond)

```typescript
design.symbols.resolved  // ◇
```

![resolved](design-language/resolved.png)

### errorResolved

Error with details indicator (red square)

```typescript
design.symbols.errorResolved  // ■
```

![errorResolved](design-language/errorResolved.png)

## Log Messages

Structured logging with appropriate visual weight.

### log-info

Informational messages during operations

```typescript
logger.info("Configuring claude-code...")
```

![log-info](design-language/log-info.png)

### log-success

Success confirmation messages

```typescript
logger.success("Configuration complete!")
```

![log-success](design-language/log-success.png)

### log-warn

Warning messages for non-critical issues

```typescript
logger.warn("API key expires in 7 days")
```

![log-warn](design-language/log-warn.png)

### log-error

Error messages for failures

```typescript
logger.error("Failed to write config file")
```

![log-error](design-language/log-error.png)

## Clack Containers

Structural UI elements from @clack/prompts.

### clack-intro

Command intro banner with animation

```typescript
intro(design.text.intro("Configure"))
```

![clack-intro](design-language/clack-intro.png)

### clack-note

Boxed note for next steps or important info

```typescript
note("Run poe-code test", "Next steps.")
```

![clack-note](design-language/clack-note.png)

### clack-outro

Command outro with feedback link

```typescript
outro(chalk.dim("Problems? https://..."))
```

![clack-outro](design-language/clack-outro.png)

### clack-resolved

Resolved prompt value display

```typescript
logger.resolved("API Key", "poe-abc...xyz")
```

![clack-resolved](design-language/clack-resolved.png)

### clack-errorResolved

Error with details display

```typescript
logger.errorResolved("Config Failed", "Missing API key")
```

![clack-errorResolved](design-language/clack-errorResolved.png)

## Complex Patterns

Multi-line UI patterns for rich interactions.

### diff

Unified diff display for file changes (used in --dry-run)

```typescript
log.message(diffLines.join("\n"), { symbol: "~" })
```

![diff](design-language/diff.png)

### menu

Interactive select prompt for choosing options

```typescript
select({ message: "Pick an agent:", options: [...] })
```

![menu](design-language/menu.png)
