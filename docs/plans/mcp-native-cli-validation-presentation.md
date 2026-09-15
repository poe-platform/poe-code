# Native JSON Schema CLI validation presentation

Adhoc screenshot /tmp/mcp-native-cli-invalid.png showed a native union failure without the affected field name. Four red maintained presentation cases reproduced this for flags, nested flags, dynamic record entries, and positionals. Format native JSON field issues consistently with other CLI value errors, including the qualified field path and existing help guidance.

Run maintained presentation/JSON/native parity checks, rebuild Toolcraft, and capture/view invalid and valid CLI screenshots after the fix. Do not add screenshot tests.

Selected Toolcraft build closure passes. Both /tmp/mcp-native-cli-invalid-final.png and /tmp/mcp-native-cli-valid-final.png were captured and viewed. Invalid input names value and gives one help hint; valid input renders Accepted and exits successfully. Native union diagnostic wording remains inherited from the JSON Schema compiler.
