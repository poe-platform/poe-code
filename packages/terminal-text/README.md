# Terminal text

Make untrusted text safe to display in terminal fields without dropping characters.
Works in browsers, Workers and Node.js with no runtime dependencies.

```ts
import { escapeTerminalText } from "@poe-code/terminal-text";

escapeTerminalText("Résumé 日本語"); // ordinary Unicode is unchanged
```

Control characters and bidirectional formatting marks become visible Unicode escapes.
