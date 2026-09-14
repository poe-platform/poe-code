export type OpFlagKind = "string" | "boolean" | "optional" | "array" | "csv";

export interface OpFlagDefinition {
  readonly kind: OpFlagKind;
  readonly alias?: string;
  readonly env?: string;
  readonly invalidEnv?: "ignore";
  readonly longAliases?: readonly string[];
  readonly availability?: "beta";
  readonly description?: string;
  readonly metavar?: string;
  readonly defaultDisplay?: string;
  readonly helpVisible?: boolean;
  readonly completionVisible?: boolean;
  readonly completionRequired?: boolean;
  readonly completionRejectEmpty?: boolean;
  readonly allowedValues?: readonly string[];
  readonly normalizeValues?: "trim-lowercase" | "lowercase";
  readonly valueSyntax?: "duration" | "go-duration" | "file-mode" | "csv" | "password-recipe";
}

export interface OpCatalogCommand {
  readonly path: readonly string[];
  readonly flags: Readonly<Record<string, OpFlagDefinition>>;
  readonly aliases: readonly string[];
  readonly availability: "stable" | "beta" | "extension";
  readonly summary: string;
  readonly description: string;
  readonly synopsis: string;
  readonly examples?: string;
  readonly helpGroup: "management" | "commands";
  readonly helpOrder: number;
  readonly args?: Readonly<{ min: number; max?: number; stdinAlternative?: boolean }>;
}

interface NodeDeclaration {
  readonly path: string;
  readonly summary: string;
  readonly description?: string;
  readonly synopsis?: string;
  readonly examples?: string;
  readonly helpGroup?: "management" | "commands";
  readonly helpOrder?: number;
  readonly flags?: string;
  readonly flagOverrides?: Readonly<Record<string, { [Key in keyof OpFlagDefinition]?: OpFlagDefinition[Key] | null }>>;
  readonly aliases?: readonly string[];
  readonly availability?: OpCatalogCommand["availability"];
  readonly args?: OpCatalogCommand["args"];
}

export const opReferenceUrl = "https://www.1password.dev/cli/reference";
export const opMetadataVersion = "2.39.0";

function freezeFlag(flag: OpFlagDefinition): OpFlagDefinition {
  return Object.freeze({ ...flag, ...(flag.longAliases ? { longAliases: Object.freeze([...flag.longAliases]) } : {}), ...(flag.allowedValues ? { allowedValues: Object.freeze([...flag.allowedValues]) } : {}) });
}

const vaultPermissionValues = Object.freeze([
  "allow_viewing", "allow_editing", "allow_managing", "view_items", "create_items",
  "view_and_copy_passwords", "edit_items", "archive_items", "delete_items",
  "view_item_history", "import_items", "export_items", "copy_and_share_items",
  "print_items", "manage_vault", "read_items", "write_items", "share_items",
]);

export const opGlobalFlags: Readonly<Record<string, OpFlagDefinition>> = Object.freeze(Object.fromEntries(
  Object.entries({
  "account": {
    "kind": "string",
    "env": "OP_ACCOUNT",
    "description": "Select the account to execute the command by account shorthand, sign-in address, account ID, or user ID. For a list of available accounts, run 'op account list'. Can be set as the OP_ACCOUNT environment variable.",
    "metavar": "account"
  },
  "cache": {
    "kind": "boolean",
    "env": "OP_CACHE",
    "description": "Store and use cached information. Caching is enabled by default on UNIX-like systems. Caching is not available on Windows. Options: true, false. Can also be set with the OP_CACHE environment variable.",
    "metavar": "",
    "defaultDisplay": "true"
  },
  "config": {
    "kind": "string",
    "env": "OP_CONFIG_DIR",
    "description": "Use this configuration directory.",
    "metavar": "directory"
  },
  "debug": {
    "kind": "boolean",
    "env": "OP_DEBUG",
    "description": "Enable debug mode. Can also be enabled by setting the OP_DEBUG environment variable to true.",
    "metavar": ""
  },
  "encoding": {
    "kind": "string",
    "description": "Use this character encoding type. Default: UTF-8. Supported: SHIFT_JIS, gbk.",
    "metavar": "type"
  },
  "format": {
    "kind": "string",
    "env": "OP_FORMAT",
    "description": "Use this output format. Can be 'human-readable' or 'json'. Can be set as the OP_FORMAT environment variable.",
    "metavar": "string",
    "defaultDisplay": "\"human-readable\""
  },
  "help": {
    "kind": "boolean",
    "alias": "h",
    "description": "Get help for op.",
    "metavar": ""
  },
  "iso-timestamps": {
    "kind": "boolean",
    "env": "OP_ISO_TIMESTAMPS",
    "invalidEnv": "ignore",
    "description": "Format timestamps according to ISO 8601 / RFC 3339. Can be set as the OP_ISO_TIMESTAMPS environment variable.",
    "metavar": ""
  },
  "no-color": {
    "kind": "boolean",
    "description": "Print output without color.",
    "metavar": ""
  },
  "session": {
    "kind": "string",
    "env": "OP_SESSION",
    "description": "Authenticate with this session token. 1Password CLI outputs session tokens for successful 'op signin' commands when 1Password app integration is not enabled.",
    "metavar": "token"
  }
} satisfies Record<string, OpFlagDefinition>).map(([name, flag]) => [name, freezeFlag(flag)]),
));

export const opRootFlags: Readonly<Record<string, OpFlagDefinition>> = Object.freeze(Object.fromEntries(
  Object.entries({
  "version": {
    "kind": "boolean",
    "alias": "v",
    "description": "version for op",
    "metavar": ""
  }
} satisfies Record<string, OpFlagDefinition>).map(([name, flag]) => [name, freezeFlag(flag)]),
));

const definitions: Readonly<Record<string, OpFlagDefinition>> = {
  "environment": { "kind": "array", "availability": "beta", "description": "Read variables from these Environments before starting the process.", "metavar": "strings" },
  "file-mode": {
    "kind": "string",
    "valueSyntax": "file-mode",
    "description": "Set filemode for the output file. It is ignored without the --out-file flag.",
    "metavar": "filemode",
    "defaultDisplay": "0600"
  },
  "force": {
    "kind": "boolean",
    "alias": "f",
    "description": "Do not prompt for confirmation.",
    "metavar": ""
  },
  "in-file": {
    "kind": "string",
    "alias": "i",
    "description": "The filename of a template file to inject.",
    "metavar": "string"
  },
  "out-file": {
    "kind": "string",
    "alias": "o",
    "description": "Write the injected template to a file instead of stdout.",
    "metavar": "string"
  },
  "no-newline": {
    "kind": "boolean",
    "alias": "n",
    "description": "Do not print a new line after the secret.",
    "metavar": ""
  },
  "env-file": {
    "kind": "array",
    "description": "Enable Dotenv integration with specific Dotenv files to parse. For example: --env-file=.env.",
    "metavar": "stringArray"
  },
  "no-masking": {
    "kind": "boolean",
    "env": "OP_RUN_NO_MASKING",
    "description": "Disable masking of secrets on stdout and stderr.",
    "metavar": ""
  },
  "raw": {
    "kind": "boolean",
    "description": "Only return the session token.",
    "metavar": ""
  },
  "all": {
    "kind": "boolean",
    "description": "Sign out of all signed-in accounts.",
    "metavar": ""
  },
  "forget": {
    "kind": "boolean",
    "description": "Remove the details for a 1Password account from this device.",
    "metavar": ""
  },
  "channel": {
    "kind": "string",
    "description": "Look for updates from a specific channel. allowed: stable, beta",
    "metavar": "string"
  },
  "directory": {
    "kind": "string",
    "description": "Download the update to this ''path''.",
    "metavar": "string"
  },
  "address": {
    "kind": "string",
    "description": "The sign-in address for your account.",
    "metavar": "string"
  },
  "email": {
    "kind": "string",
    "description": "The email address associated with your account.",
    "metavar": "string"
  },
  "shorthand": {
    "kind": "string",
    "description": "Set a custom account shorthand for your account.",
    "metavar": "string"
  },
  "signin": {
    "kind": "boolean",
    "description": "Immediately sign in to the added account.",
    "metavar": ""
  },
  "file-name": {
    "kind": "string",
    "description": "Set the file's name.",
    "metavar": "name"
  },
  "tags": {
    "kind": "csv",
    "valueSyntax": "csv",
    "description": "Set the tags to the specified (comma-separated) values.",
    "metavar": "tags"
  },
  "title": {
    "kind": "string",
    "description": "Set the document item's title.",
    "metavar": "title"
  },
  "vault": {
    "kind": "string",
    "description": "Look for the item in this vault.",
    "metavar": "string"
  },
  "include-archive": {
    "kind": "boolean",
    "env": "OP_INCLUDE_ARCHIVE",
    "description": "Include document items in the Archive. Can also be set using OP_INCLUDE_ARCHIVE environment variable.",
    "metavar": ""
  },
  "archive": {
    "kind": "boolean",
    "description": "Move the document to the Archive.",
    "metavar": ""
  },
  "expires-in": {
    "kind": "string",
    "valueSyntax": "duration",
    "description": "Set how the long the events-api token is valid for in (s)econds, (m)inutes, (h)ours, (d)ays, and/or (w)eeks.",
    "metavar": "duration"
  },
  "features": {
    "kind": "csv",
    "valueSyntax": "csv",
    "description": "Set the comma-separated list of features the integration token can be used for. Options: 'signinattempts', 'itemusages', 'auditevents'.",
    "metavar": "features"
  },
  "description": {
    "kind": "string",
    "description": "Set the group's description.",
    "metavar": "string"
  },
  "name": {
    "kind": "string",
    "description": "Change the group's name.",
    "metavar": "name"
  },
  "user": {
    "kind": "string",
    "description": "List groups that a user belongs to.",
    "metavar": "user"
  },
  "category": {
    "kind": "string",
    "description": "Set the item's category.",
    "metavar": "category"
  },
  "dry-run": {
    "kind": "boolean",
    "description": "Test the command and output a preview of the resulting item.",
    "metavar": ""
  },
  "favorite": {
    "kind": "boolean",
    "description": "Add item to favorites.",
    "metavar": ""
  },
  "generate-password": {
    "kind": "optional",
    "valueSyntax": "password-recipe",
    "description": "Add a randomly-generated password to a Login or Password item.",
    "metavar": "recipe"
  },
  "reveal": {
    "kind": "boolean",
    "description": "Don't conceal sensitive fields.",
    "metavar": ""
  },
  "ssh-generate-key": {
    "kind": "string",
    "allowedValues": ["ed25519", "rsa", "rsa2048", "rsa3072", "rsa4096", "rsa-2048", "rsa-3072", "rsa-4096"],
    "normalizeValues": "lowercase",
    "description": "The type of SSH key to create: Ed25519 or RSA. For RSA, specify 2048, 3072, or 4096 (default) bits. Possible values: 'ed25519', 'rsa', 'rsa2048', 'rsa3072', 'rsa4096'.",
    "metavar": "",
    "defaultDisplay": "Ed25519"
  },
  "template": {
    "kind": "string",
    "description": "Specify the file path to read an item template from.",
    "metavar": "string"
  },
  "url": {
    "kind": "string",
    "description": "Set the URL associated with the item",
    "metavar": "URL"
  },
  "fields": {
    "kind": "csv",
    "valueSyntax": "csv",
    "longAliases": [
      "field"
    ],
    "description": "Return data from specific fields. Use 'label=' to get the field by name or 'type=' to filter fields by type. Specify multiple in a comma-separated list.",
    "metavar": "strings"
  },
  "otp": {
    "kind": "boolean",
    "description": "Output the primary one-time password for this item.",
    "metavar": ""
  },
  "share-link": {
    "kind": "boolean",
    "description": "Get a shareable link for the item.",
    "metavar": ""
  },
  "categories": {
    "kind": "csv",
    "valueSyntax": "csv",
    "description": "Only list items in these categories (comma-separated).",
    "metavar": "categories"
  },
  "long": {
    "kind": "boolean",
    "description": "Output a more detailed item list.",
    "metavar": ""
  },
  "current-vault": {
    "kind": "string",
    "description": "Vault where the item is currently saved.",
    "metavar": "string"
  },
  "destination-vault": {
    "kind": "string",
    "description": "The vault you want to move the item to.",
    "metavar": "string"
  },
  "emails": {
    "kind": "csv",
    "valueSyntax": "csv",
    "description": "Email addresses to share with.",
    "metavar": "strings"
  },
  "view-once": {
    "kind": "boolean",
    "description": "Expire link after a single view.",
    "metavar": ""
  },
  "can-create-vaults": {
    "kind": "boolean",
    "description": "Allow the service account to create new vaults.",
    "metavar": ""
  },
  "language": {
    "kind": "string",
    "description": "Provide the user's account language.",
    "metavar": "string",
    "defaultDisplay": "\"en\""
  },
  "fingerprint": {
    "kind": "boolean",
    "description": "Get the user's public key fingerprint.",
    "metavar": ""
  },
  "me": {
    "kind": "boolean",
    "description": "Get the authenticated user's details.",
    "metavar": ""
  },
  "public-key": {
    "kind": "boolean",
    "description": "Get the user's public key.",
    "metavar": ""
  },
  "travel-mode": {
    "kind": "string",
    "allowedValues": ["on", "off"],
    "description": "Turn Travel Mode on or off for the user.",
    "metavar": "on|off",
    "defaultDisplay": "off"
  },
  "deauthorize-devices-after": {
    "kind": "string",
    "valueSyntax": "go-duration",
    "description": "Deauthorize the user's devices after a time (rounded down to seconds).",
    "metavar": "duration"
  },
  "group": {
    "kind": "string",
    "description": "The group to receive access.",
    "metavar": "group"
  },
  "allow-admins-to-manage": {
    "kind": "string",
    "allowedValues": ["true", "false", "TRUE", "FALSE", "True", "False", "t", "f", "T", "F", "1", "0"],
    "description": "Set whether administrators can manage the vault. If not provided, the default policy for the account applies.",
    "metavar": "true|false"
  },
  "icon": {
    "kind": "string",
    "description": "Set the vault icon.",
    "metavar": "string"
  },
  "permission": {
    "kind": "csv",
    "allowedValues": vaultPermissionValues,
    "normalizeValues": "trim-lowercase",
    "description": "List only vaults that the specified user/group has this permission for.",
    "metavar": "permissions"
  },
  "all-servers": {
    "kind": "boolean",
    "description": "Grant access to all current and future servers in the authenticated account.",
    "metavar": ""
  },
  "server": {
    "kind": "string",
    "description": "Only look for tokens for this 1Password Connect server.",
    "metavar": "string"
  },
  "vaults": {
    "kind": "csv",
    "valueSyntax": "csv",
    "description": "Grant the Connect server access to these vaults.",
    "metavar": "strings"
  },
  "role": {
    "kind": "string",
    "allowedValues": ["manager", "member"],
    "normalizeValues": "lowercase",
    "description": "Specify the user's role as a member or manager. Default: member.",
    "metavar": "string"
  },
  "no-input": {
    "kind": "boolean",
    "description": "Do not prompt for input on interactive terminal.",
    "metavar": "input"
  },
  "permissions": {
    "kind": "csv",
    "allowedValues": vaultPermissionValues,
    "normalizeValues": "trim-lowercase",
    "description": "The permissions to grant to the group.",
    "metavar": "permissions"
  },
  "vars": {
    "kind": "csv",
    "valueSyntax": "csv",
    "description": "Capture only these comma-separated variable names, including names that are unset.",
    "metavar": "strings"
  },
  "shell": {
    "kind": "string",
    "description": "Print restoration commands for bash, zsh, sh, fish, or powershell.",
    "metavar": "string"
  }
};

const declarations: readonly NodeDeclaration[] = [
  {"path":"","summary":"Portable op-compatible command interface","description":"This portable implementation exposes an op-compatible command interface with a configurable backend and host approval policies.\n\nStable command metadata targets 1Password CLI 2.39.0. Beta commands and local extensions are identified separately."},
  {"path":"account","summary":"Manage your locally configured 1Password accounts","helpGroup":"management","helpOrder":0},
  {"path":"connect","summary":"Manage Connect server instances and tokens in your 1Password account","helpGroup":"management","helpOrder":1},
  {"path":"document","summary":"Perform CRUD operations on Document items in your vaults","helpGroup":"management","helpOrder":2},
  {"path":"events-api","summary":"Manage Events API integrations in your 1Password account","helpGroup":"management","helpOrder":3},
  {"path":"group","summary":"Manage the groups in your 1Password account","helpGroup":"management","helpOrder":4},
  {"path":"item","summary":"Perform CRUD operations on the 1Password items in your vaults","helpGroup":"management","helpOrder":5},
  {"path":"plugin","summary":"Manage the shell plugins you use to authenticate third-party CLIs","helpGroup":"management","helpOrder":6},
  {"path":"service-account","summary":"Manage service accounts","helpGroup":"management","helpOrder":7},
  {"path":"user","summary":"Manage users within this 1Password account","helpGroup":"management","helpOrder":8},
  {"path":"vault","summary":"Manage permissions and perform CRUD operations on your 1Password vaults","helpGroup":"management","helpOrder":9},
  {"path":"completion","summary":"Generate shell completion information","synopsis":"<shell> [flags]","helpGroup":"commands","helpOrder":0,"description":"Print a shell adapter for Bash, Zsh, fish, or PowerShell. Source the generated text in the selected shell to activate command and flag completion.\n\nCompletion callbacks return catalog metadata without loading a backend. Backend-backed argument suggestions are not provided.","examples":"Load Bash completions:\n\n\tsource <(op completion bash)\n\nLoad fish completions:\n\n\top completion fish | source"},
  {"path":"inject","summary":"Inject secrets into a config file","helpGroup":"commands","helpOrder":1,"flags":"file-mode force in-file out-file","description":"Substitute secret references inside a template. Templates come from stdin or --in-file; output goes to stdout or --out-file.\n\nThe result can contain plaintext secrets. Host authorization may deny the operation before resolution begins.","examples":"Render a template into a separate file:\n\n\top inject --in-file ./example.conf.tpl --out-file ./example.conf"},
  {"path":"read","summary":"Read a secret reference","synopsis":"<reference> [flags]","helpGroup":"commands","helpOrder":2,"flags":"file-mode force no-newline out-file","flagOverrides":{"out-file":{"description":"Write the secret to a file instead of stdout."}},"description":"Resolve an op:// secret reference and write its value. References may address fields or attachments and can include supported attribute queries.\n\nOutput is plaintext or raw attachment bytes, not a secrecy boundary. --out-file redirects the result to a file, and --no-newline suppresses a trailing newline for text.","examples":"Resolve a password field:\n\n\top read op://example-vault/example-item/password","args":{"min":1,"max":1}},
  {"path":"run","summary":"Pass secrets as environment variables to a process","synopsis":"-- <command> <command>... [flags]","helpGroup":"commands","helpOrder":3,"flags":"env-file environment no-masking","description":"Start a child command with resolved secret values in its environment. Put -- before the child command so its options are not parsed as op flags.\n\nDotenv input remains UTF-8. Output masking is enabled unless --no-masking is requested; masking is not a substitute for keeping child output confidential.","examples":"Pass resolved environment values to a child:\n\n\top run --env-file ./example.env -- ./example-worker","args":{"min":1}},
  {"path":"signin","summary":"Sign in to a 1Password account","helpGroup":"commands","helpOrder":4,"flags":"force raw","flagOverrides":{"force":{"description":"Ignore warnings and print raw output from this command."}},"description":"Request authentication from the configured backend. Manual mode returns a session token for subsequent operations; app integration delegates authentication to a configured host hook. Backend capabilities determine which authentication methods are available."},
  {"path":"signout","summary":"Sign out of a 1Password account","helpGroup":"commands","helpOrder":5,"flags":"all forget"},
  {"path":"update","summary":"Check for and download updates.","helpGroup":"commands","helpOrder":6,"flags":"channel directory"},
  {"path":"whoami","summary":"Get information about a signed-in account","helpGroup":"commands","helpOrder":7,"args":{"min":0,"max":0}},
  {"path":"account add","summary":"Add an account to sign in to for the first time","helpGroup":"commands","helpOrder":0,"flags":"address email raw shorthand signin"},
  {"path":"account get","summary":"Get details about your account","helpGroup":"commands","helpOrder":1},
  {"path":"account list","summary":"List users and accounts set up on this device","helpGroup":"commands","helpOrder":2,"aliases":["ls"]},
  {"path":"account forget","summary":"Remove a 1Password account from this device","synopsis":"[ <account> ] [flags]","helpGroup":"commands","helpOrder":3,"flags":"all","flagOverrides":{"all":{"description":"Forget all authenticated accounts."}}},
  {"path":"connect group","summary":"Manage group access to Secrets Automation","helpGroup":"management","helpOrder":0},
  {"path":"connect server","summary":"Manage Connect servers","helpGroup":"management","helpOrder":1},
  {"path":"connect token","summary":"Manage Connect server tokens","helpGroup":"management","helpOrder":2},
  {"path":"connect vault","summary":"Manage Connect server vault access","helpGroup":"management","helpOrder":3},
  {"path":"document create","summary":"Create a document item","synopsis":"[{ <file> | - }] [flags]","helpGroup":"commands","helpOrder":0,"flags":"file-name tags title vault","flagOverrides":{"vault":{"description":"Save the document in this vault. Default: Private, Personal, or Employee, depending on your account type.","metavar":"vault"}},"description":"Upload file bytes or read them from stdin when no file is given or the file argument is -. The file name and title can be supplied explicitly. Choose the destination with --vault.\n\nDocument uploads preserve their binary content."},
  {"path":"document get","summary":"Download a document","synopsis":"{ <itemName> | <itemID> } [flags]","helpGroup":"commands","helpOrder":1,"flags":"file-mode force include-archive out-file vault","flagOverrides":{"force":{"alias":null,"description":"Forcibly print an unintelligible document to an interactive terminal. If --out-file is specified, save the document to a file without prompting for confirmation."},"out-file":{"description":"Save the document to the file path instead of stdout.","metavar":"path"},"vault":{"description":"Look for the document in this vault.","metavar":"vault"}},"description":"Download the document as bytes. With no output path, bytes go to stdout; --out-file writes a file instead. --file-mode controls the output file mode.\n\n--force permits binary output to an interactive terminal and skips overwrite confirmation for a destination file. Document bytes are not text-transcoded.","examples":"Save a document without interpreting its contents as text:\n\n\top document get 'Example document' --out-file ./example-document.bin","args":{"min":1,"max":1}},
  {"path":"document edit","summary":"Edit a document item","synopsis":"{ <itemName> | <itemID> } [{ <file> | - }] [flags]","helpGroup":"commands","helpOrder":2,"flags":"file-name tags title vault","flagOverrides":{"tags":{"description":"Set the tags to the specified (comma-separated) values. An empty value removes all tags."},"vault":{"description":"Look up document in this vault.","metavar":"vault"}},"description":"Replace the selected document's content using file bytes or stdin. File name, title, tags, and vault selectors remain separate from the binary payload."},
  {"path":"document delete","summary":"Delete or archive a document item","synopsis":"[{ <itemName> | <itemID> | - }] [flags]","helpGroup":"commands","helpOrder":3,"flags":"archive vault","flagOverrides":{"vault":{"description":"Delete the document in this vault.","metavar":"vault"}},"aliases":["remove","rm"]},
  {"path":"document list","summary":"Get a list of documents","helpGroup":"commands","helpOrder":4,"flags":"include-archive vault","flagOverrides":{"vault":{"description":"Only list documents in this vault.","metavar":"vault"}},"aliases":["ls"]},
  {"path":"events-api create","summary":"Set up an integration with the Events API","synopsis":"<name> [flags]","helpGroup":"commands","helpOrder":0,"flags":"expires-in features"},
  {"path":"group user","summary":"Manage group membership","helpGroup":"management","helpOrder":0},
  {"path":"group create","summary":"Create a group","synopsis":"<name> [flags]","helpGroup":"commands","helpOrder":0,"flags":"description"},
  {"path":"group get","summary":"Get details about a group","synopsis":"[{ <groupName> | <groupID> | - }] [flags]","helpGroup":"commands","helpOrder":1},
  {"path":"group edit","summary":"Edit a group's name or description","synopsis":"[{ <groupName> | <groupID> | - }] [flags]","helpGroup":"commands","helpOrder":2,"flags":"description name","flagOverrides":{"description":{"description":"Change the group's description.","metavar":"description"}}},
  {"path":"group delete","summary":"Remove a group","synopsis":"[{ <groupName> | <groupID> | - }] [flags]","helpGroup":"commands","helpOrder":3,"aliases":["remove","rm"]},
  {"path":"group list","summary":"List groups","helpGroup":"commands","helpOrder":4,"flags":"user vault","flagOverrides":{"vault":{"description":"List groups that have direct access to a vault.","metavar":"vault"}},"aliases":["ls"]},
  {"path":"item template","summary":"Manage templates","helpGroup":"management","helpOrder":0},
  {"path":"item create","summary":"Create an item","synopsis":"[ - ] [ <assignment>... ] [flags]","helpGroup":"commands","helpOrder":0,"flags":"category dry-run favorite generate-password reveal ssh-generate-key tags template title url vault","flagOverrides":{"title":{"description":"Set the item's title."},"vault":{"description":"Save the item in this vault. Default: Private, Personal, or Employee, depending on your account type.","metavar":"vault"}},"description":"Create an item from assignments, a JSON template file, or JSON received on stdin. A leading - selects stdin; it cannot be combined with --template. Assignments override matching template fields.\n\nAssignment syntax is [section.]field[type]=value. Escape punctuation in field and section names with a backslash. For confidential values, prefer a template or stdin over command-line assignments, which may remain in shell history.\n\nPassword generation accepts a recipe of length and character classes. SSH key generation accepts an explicit key type.","examples":"Prepare a JSON template and create an item from it:\n\n\top item template get Login --out-file ./example-login.json\n\top item create --template ./example-login.json --vault 'Example vault'"},
  {"path":"item get","summary":"Get an item's details","synopsis":"[{ <itemName> | <itemID> | <shareLink> | - }] [flags]","helpGroup":"commands","helpOrder":1,"flags":"fields include-archive otp reveal share-link vault","flagOverrides":{"include-archive":{"description":"Include items in the Archive. Can also be set using OP_INCLUDE_ARCHIVE environment variable."}},"description":"Choose an item using its name, ID, or sharing link. The --vault selector narrows the lookup; service-account requests need a vault selection.\n\nFor batch input, pass - and provide selectors on stdin. JSON objects with id properties can also identify the requested items.\n\nUse --fields to select labels or types, --otp for the primary one-time password, and --format=json for structured output. Human output conceals sensitive fields unless --reveal is supplied. Use op read for the value behind a secret reference.","examples":"Select fields by their labels:\n\n\top item get 'Example item' --fields label=username,label=password --format=json\n\nSelect concealed fields:\n\n\top item get 'Example item' --fields type=concealed\n\nRead a batch of item IDs:\n\n\top item list --vault 'Example vault' --format=json | op item get -","args":{"min":0,"max":1,"stdinAlternative":true}},
  {"path":"item edit","summary":"Edit an item's details","synopsis":"{ <itemName> | <itemID> | <shareLink> } [ <assignment> ... ] [flags]","helpGroup":"commands","helpOrder":2,"flags":"dry-run favorite generate-password reveal tags template title url vault","flagOverrides":{"dry-run":{"description":"Perform a dry run of the command and output a preview of the resulting item."},"favorite":{"description":"Whether this item is a favorite item. Options: true, false"},"generate-password":{"description":"Give the item a randomly generated password."},"tags":{"description":"Set the tags to the specified (comma-separated) values. An empty value will remove all tags."},"template":{"description":"Specify the filepath to read an item template from."},"title":{"description":"Set the item's title."},"vault":{"description":"Edit the item in this vault.","metavar":"vault"}},"description":"Select the item first, then provide assignments or a JSON template containing the changes. Existing fields remain unless the update replaces or removes them. Use --dry-run to inspect the resulting item before writing it.\n\nAvoid placing confidential values directly in command arguments."},
  {"path":"item delete","summary":"Delete or archive an item","synopsis":"[{ <itemName> | <itemID> | <shareLink> | - }] [flags]","helpGroup":"commands","helpOrder":3,"flags":"archive vault","flagOverrides":{"archive":{"description":"Move the item to the Archive."}},"aliases":["remove","rm"]},
  {"path":"item list","summary":"List items","helpGroup":"commands","helpOrder":4,"flags":"categories favorite include-archive long tags vault","flagOverrides":{"favorite":{"description":"Only list favorite items"},"include-archive":{"description":"Include items in the Archive. Can also be set using OP_INCLUDE_ARCHIVE environment variable."},"tags":{"description":"Only list items with these tags (comma-separated)."},"vault":{"description":"Only list items in this vault.","metavar":"vault"}},"aliases":["ls"]},
  {"path":"item move","summary":"Move an item between vaults","synopsis":"[{ <itemName> | <itemID> | <shareLink> | - }] [flags]","helpGroup":"commands","helpOrder":5,"flags":"current-vault destination-vault reveal","aliases":["mv"],"flagOverrides":{"destination-vault":{"completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"item share","summary":"Share an item","synopsis":"{ <itemName> | <itemID> } [flags]","helpGroup":"commands","helpOrder":6,"flags":"emails expires-in vault view-once","flagOverrides":{"expires-in":{"description":"Expire link after the duration specified in (s)econds, (m)inutes, (h)ours, (d)ays, and/or (w)eeks.","longAliases":["expiry"],"defaultDisplay":"7d"}}},
  {"path":"plugin credential","summary":"Manage credentials for shell plugins","helpGroup":"management","helpOrder":0},
  {"path":"plugin list","summary":"List all available shell plugins","helpGroup":"commands","helpOrder":0,"aliases":["ls"]},
  {"path":"plugin clear","summary":"Clear shell plugin configuration","synopsis":"<plugin-name> [flags]","helpGroup":"commands","helpOrder":1,"flags":"all force","flagOverrides":{"all":{"description":"Clear all configurations for this plugin that apply to this directory and/or terminal session, including the global default."},"force":{"description":"Apply immediately without asking for confirmation."}},"aliases":["reset"],"description":"Remove applicable plugin defaults. A single clear removes the active scope; --all includes the other applicable directory, terminal, and global defaults. Confirmation and host authorization are separate decisions: --force does not override authorization."},
  {"path":"plugin init","summary":"Configure a shell plugin","synopsis":"[ <plugin-executable> ] [flags]","helpGroup":"commands","helpOrder":2},
  {"path":"plugin inspect","summary":"Inspect your existing shell plugin configurations","synopsis":"[ <plugin-name> ] [flags]","helpGroup":"commands","helpOrder":3,"aliases":["info"]},
  {"path":"plugin run","summary":"Provision credentials from 1Password and run this command","synopsis":"<command>... [flags]","helpGroup":"commands","helpOrder":4},
  {"path":"service-account create","summary":"Create a service account","synopsis":"<serviceAccountName> [flags]","helpGroup":"commands","helpOrder":0,"flags":"can-create-vaults expires-in raw vault","flagOverrides":{"expires-in":{"description":"Set how long the service account is valid for in (s)econds, (m)inutes, (h)ours, (d)ays, or (w)eeks."},"raw":{"description":"Only return the service account token."},"vault":{"kind":"array","description":"Give access to this vault with a set of permissions. Has syntax <vault-name>:<permission>[,<permission>]","metavar":"stringArray"}}},
  {"path":"service-account ratelimit","summary":"Retrieve rate limit usage for a service account","synopsis":"[{ <serviceAccountName> | <serviceAccountID> }] [flags]","helpGroup":"commands","helpOrder":1,"aliases":["ratelimits"]},
  {"path":"user recovery","summary":"Manage user recovery in your 1Password account","helpGroup":"management","helpOrder":0},
  {"path":"user provision","summary":"Provision a user in the authenticated account","helpGroup":"commands","helpOrder":0,"flags":"email language name","flagOverrides":{"email":{"description":"Provide the user's email address.","completionRequired":true,"completionRejectEmpty":true},"name":{"description":"Provide the user's name.","metavar":"string","completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"user confirm","summary":"Confirm a user","synopsis":"[{ <email> | <name> | <userID> | - }] [flags]","helpGroup":"commands","helpOrder":1,"flags":"all","flagOverrides":{"all":{"description":"Confirm all unconfirmed users."}}},
  {"path":"user get","summary":"Get details about a user","synopsis":"[{ <email> | <name> | <userID> | --me | - }] [flags]","helpGroup":"commands","helpOrder":2,"flags":"fingerprint me public-key"},
  {"path":"user edit","summary":"Edit a user's name or Travel Mode status","synopsis":"[{ <email> | <name> | <userID> | - }] [flags]","helpGroup":"commands","helpOrder":3,"flags":"name travel-mode","flagOverrides":{"name":{"description":"Set the user's name.","metavar":"string"}}},
  {"path":"user suspend","summary":"Suspend a user","synopsis":"[{ <email> | <name> | <userID> | - }] [flags]","helpGroup":"commands","helpOrder":4,"flags":"deauthorize-devices-after"},
  {"path":"user reactivate","summary":"Reactivate a suspended user","synopsis":"[{ <email> | <name> | <userID> | - }] [flags]","helpGroup":"commands","helpOrder":5},
  {"path":"user delete","summary":"Remove a user and all their data from the account","synopsis":"[{ <email> | <name> | <userID> | - }] [flags]","helpGroup":"commands","helpOrder":6,"aliases":["remove","rm"]},
  {"path":"user list","summary":"List users","helpGroup":"commands","helpOrder":7,"flags":"group vault","flagOverrides":{"group":{"description":"List users who belong to a group."},"vault":{"description":"List users who have direct access to vault.","metavar":"vault"}},"aliases":["ls"]},
  {"path":"vault group","summary":"Manage group vault access","helpGroup":"management","helpOrder":0},
  {"path":"vault user","summary":"Manage user vault access","helpGroup":"management","helpOrder":1},
  {"path":"vault create","summary":"Create a new vault","synopsis":"<name> [flags]","helpGroup":"commands","helpOrder":0,"flags":"allow-admins-to-manage description icon","flagOverrides":{"description":{"metavar":"description"}}},
  {"path":"vault get","summary":"Get details about a vault","synopsis":"[{ <vaultName> | <vaultID> | - }] [flags]","helpGroup":"commands","helpOrder":1},
  {"path":"vault edit","summary":"Edit a vault's name, description, icon, or Travel Mode status","synopsis":"[{ <vaultName> | <vaultID> | - }] [flags]","helpGroup":"commands","helpOrder":2,"flags":"description icon name travel-mode","flagOverrides":{"description":{"description":"Change the vault's description.","metavar":"description"},"icon":{"description":"Change the vault's icon.","metavar":"icon"},"name":{"description":"Change the vault's name."},"travel-mode":{"description":"Turn Travel Mode on or off for the vault."}}},
  {"path":"vault delete","summary":"Remove a vault","synopsis":"[{ <vaultName> | <vaultID> | - }] [flags]","helpGroup":"commands","helpOrder":3,"aliases":["remove","rm"]},
  {"path":"vault list","summary":"List all vaults in the account","helpGroup":"commands","helpOrder":4,"flags":"group permission user","flagOverrides":{"group":{"description":"List vaults a group has access to.","metavar":"string"},"user":{"description":"List vaults that a given user has access to.","metavar":"string"}},"aliases":["ls"],"args":{"min":0,"max":0}},
  {"path":"connect group grant","summary":"Grant a group access to manage Secrets Automation","helpGroup":"commands","helpOrder":0,"flags":"all-servers group server","flagOverrides":{"server":{"description":"The server to grant access to.","metavar":"server"},"group":{"completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"connect group revoke","summary":"Revoke a group's access to manage Secrets Automation","helpGroup":"commands","helpOrder":1,"flags":"all-servers group server","flagOverrides":{"all-servers":{"description":"Revoke access to all current and future servers in the authenticated account."},"group":{"description":"The group to revoke access from.","completionRequired":true,"completionRejectEmpty":true},"server":{"description":"The server to revoke access to.","metavar":"server"}}},
  {"path":"connect server create","summary":"Set up a Connect server","synopsis":"<name> [flags]","helpGroup":"commands","helpOrder":0,"flags":"force vaults","flagOverrides":{"force":{"description":"Do not prompt for confirmation when overwriting credential files."}}},
  {"path":"connect server get","summary":"Get a Connect server","synopsis":"[{ <serverName> | <serverID> | - }] [flags]","helpGroup":"commands","helpOrder":1},
  {"path":"connect server edit","summary":"Rename a Connect server","synopsis":"{ <serverName> | <serverID> } [flags]","helpGroup":"commands","helpOrder":2,"flags":"name","flagOverrides":{"name":{"description":"Change the server's name."}}},
  {"path":"connect server delete","summary":"Remove a Connect server","synopsis":"[{ <serverName> | <serverID> | - }] [flags]","helpGroup":"commands","helpOrder":3,"aliases":["remove","rm"]},
  {"path":"connect server list","summary":"List Connect servers","helpGroup":"commands","helpOrder":4,"aliases":["ls"]},
  {"path":"connect token create","summary":"Issue a token for a 1Password Connect server","synopsis":"<tokenName> [flags]","helpGroup":"commands","helpOrder":0,"flags":"expires-in server vault","flagOverrides":{"expires-in":{"description":"Set how long the Connect token is valid for in (s)econds, (m)inutes, (h)ours, (d)ays, and/or (w)eeks."},"server":{"description":"Issue a token for this server.","completionRequired":true},"vault":{"kind":"array","description":"Issue a token on these vaults.","metavar":"stringArray"}}},
  {"path":"connect token edit","summary":"Rename a Connect server token","synopsis":"<token> [flags]","helpGroup":"commands","helpOrder":1,"flags":"name server","flagOverrides":{"name":{"description":"Change the token's name.","metavar":"string"}}},
  {"path":"connect token delete","summary":"Revoke a token for a Connect server","synopsis":"[ <token> ] [flags]","helpGroup":"commands","helpOrder":2,"flags":"server","aliases":["remove","rm"]},
  {"path":"connect token list","summary":"Get a list of tokens","helpGroup":"commands","helpOrder":3,"flags":"server","flagOverrides":{"server":{"description":"Only list tokens for this Connect server.","metavar":"server"}},"aliases":["ls"]},
  {"path":"connect vault grant","summary":"Grant a Connect server access to a vault","helpGroup":"commands","helpOrder":0,"flags":"server vault","flagOverrides":{"server":{"description":"The server to be granted access.","completionRequired":true,"completionRejectEmpty":true},"vault":{"description":"The vault to grant access to.","completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"connect vault revoke","summary":"Revoke a Connect server's access to a vault","helpGroup":"commands","helpOrder":1,"flags":"server vault","flagOverrides":{"server":{"description":"The server to revoke access from.","metavar":"server","completionRequired":true,"completionRejectEmpty":true},"vault":{"description":"The vault to revoke a server's access to.","metavar":"vault","completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"group user grant","summary":"Add a user to a group","helpGroup":"commands","helpOrder":0,"flags":"group role user","flagOverrides":{"group":{"description":"Specify the group to add the user to.","metavar":"string","completionRequired":true,"completionRejectEmpty":true},"user":{"description":"Specify the user to add to the group.","metavar":"string","completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"group user revoke","summary":"Remove a user from a group","helpGroup":"commands","helpOrder":1,"flags":"group user","flagOverrides":{"group":{"description":"Specify the group to remove the user from.","metavar":"string","completionRequired":true,"completionRejectEmpty":true},"user":{"description":"Specify the user to remove from the group.","metavar":"string","completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"group user list","summary":"Retrieve users that belong to a group","synopsis":"<group> [flags]","helpGroup":"commands","helpOrder":2,"aliases":["ls"]},
  {"path":"item template get","summary":"Get an item template","synopsis":"[{ <category> | - }] [flags]","helpGroup":"commands","helpOrder":0,"flags":"file-mode force out-file","flagOverrides":{"out-file":{"description":"Write the template to a file instead of stdout."}}},
  {"path":"item template list","summary":"Get a list of templates","helpGroup":"commands","helpOrder":1,"aliases":["ls"],"args":{"min":0,"max":0}},
  {"path":"plugin credential import","summary":"Import credentials for a shell plugin","synopsis":"<plugin-name> [flags]","helpGroup":"commands","helpOrder":0},
  {"path":"user recovery begin","summary":"Begin recovery for users in your 1Password account","synopsis":"[ { <email> | <name> | <userID> } ] [flags]","helpGroup":"commands","helpOrder":0},
  {"path":"vault group grant","summary":"Grant a group permissions to a vault","helpGroup":"commands","helpOrder":0,"flags":"group no-input permissions vault","flagOverrides":{"vault":{"description":"The vault to grant group permissions to.","metavar":"vault","completionRequired":true,"completionRejectEmpty":true},"group":{"completionRequired":true,"completionRejectEmpty":true},"permissions":{"completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"vault group revoke","summary":"Revoke a portion or the entire access of a group to a vault","helpGroup":"commands","helpOrder":1,"flags":"group no-input permissions vault","flagOverrides":{"group":{"description":"The group to revoke access from.","completionRequired":true,"completionRejectEmpty":true},"permissions":{"description":"The permissions to revoke from the group."},"vault":{"description":"The vault to revoke access to.","metavar":"vault","completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"vault group list","summary":"List all the groups that have access to the given vault","synopsis":"[{ <vault> | - }] [flags]","helpGroup":"commands","helpOrder":2,"aliases":["ls"]},
  {"path":"vault user grant","summary":"Grant a user access to a vault","helpGroup":"commands","helpOrder":0,"flags":"no-input permissions user vault","flagOverrides":{"permissions":{"description":"The permissions to grant to the user.","completionRequired":true,"completionRejectEmpty":true},"user":{"description":"The user to receive access.","completionRequired":true,"completionRejectEmpty":true},"vault":{"description":"The vault to grant access to.","metavar":"vault","completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"vault user revoke","summary":"Revoke a portion or the entire access of a user to a vault","helpGroup":"commands","helpOrder":1,"flags":"no-input permissions user vault","flagOverrides":{"permissions":{"description":"The permissions to revoke from the user."},"user":{"description":"The user to revoke access from.","completionRequired":true,"completionRejectEmpty":true},"vault":{"description":"The vault to revoke access to.","metavar":"vault","completionRequired":true,"completionRejectEmpty":true}}},
  {"path":"vault user list","summary":"List all users with access to the vault and their permissions","synopsis":"<vault> [flags]","helpGroup":"commands","helpOrder":2,"aliases":["ls"]},
  {"path":"environment read","summary":"Read an Environment","synopsis":"<environment> [flags]","helpGroup":"commands","helpOrder":0,"availability":"beta","args":{"min":1,"max":1}},
  {"path":"environment snapshot create","summary":"Capture an environment snapshot","synopsis":"<name> [flags]","helpGroup":"commands","helpOrder":0,"availability":"extension","flags":"vars","args":{"min":1,"max":1}},
  {"path":"environment snapshot get","summary":"Get an environment snapshot","synopsis":"<snapshot> [flags]","helpGroup":"commands","helpOrder":0,"availability":"extension","args":{"min":1,"max":1}},
  {"path":"environment snapshot list","summary":"List environment snapshots","helpGroup":"commands","helpOrder":0,"availability":"extension","args":{"min":0,"max":0}},
  {"path":"environment snapshot delete","summary":"Delete an environment snapshot","synopsis":"<snapshot> [flags]","helpGroup":"commands","helpOrder":0,"availability":"extension","args":{"min":1,"max":1}},
  {"path":"environment snapshot restore","summary":"Restore an environment snapshot","synopsis":"<snapshot> [-- command args...] [flags]","helpGroup":"commands","helpOrder":0,"availability":"extension","flags":"shell no-masking","flagOverrides":{"no-masking":{"env":null,"description":"Do not conceal captured values in child process output."}},"description":"Restore the snapshot through a host callback, start a child with the restored environment, or print shell commands with --shell.\n\nSelected snapshots affect only captured names; null entries explicitly remove those names. Complete snapshots also remove known current extras. Shell evaluation is not atomic, and readonly variables may prevent changes.","examples":"Print commands for restoring captured variables:\n\n\top environment snapshot restore example --shell=bash","args":{"min":1}},
  {"path":"environment","summary":"Manage Environments and local snapshots","synopsis":"[command] [flags]","helpGroup":"management","helpOrder":99,"availability":"extension"},
  {"path":"environment snapshot","summary":"Manage local environment snapshots","synopsis":"[command] [flags]","helpGroup":"management","helpOrder":99,"availability":"extension"},
];

export const opCatalogNodes: readonly OpCatalogCommand[] = Object.freeze(declarations.map(declaration => {
  const { flags: names = "", flagOverrides = {}, path: name, ...metadata } = declaration;
  const path = name ? name.split(" ") : [];
  const group = declarations.some(child => name ? child.path.startsWith(name + " ") : child.path !== "");
  const flags = Object.fromEntries(names.split(" ").filter(Boolean).map(flag => {
    const merged = { ...(definitions[flag] ?? opGlobalFlags[flag]), ...flagOverrides[flag] };
    return [flag, freezeFlag(Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null)) as unknown as OpFlagDefinition)];
  }));
  return Object.freeze({
    ...metadata,
    path: Object.freeze(path),
    flags: Object.freeze(flags),
    aliases: Object.freeze([...(metadata.aliases ?? [])]),
    availability: metadata.availability ?? "stable",
    description: metadata.description ?? metadata.summary,
    synopsis: metadata.synopsis ?? (group ? "[command] [flags]" : "[flags]"),
    helpGroup: metadata.helpGroup ?? "commands",
    helpOrder: metadata.helpOrder ?? 0,
    ...(metadata.args ? { args: Object.freeze({ ...metadata.args }) } : {}),
  });
}));

export const opCommandCatalog: readonly OpCatalogCommand[] = Object.freeze(opCatalogNodes.filter(node =>
  node.path.length > 0 && !opCatalogNodes.some(child =>
    child.path.length > node.path.length && node.path.every((part, index) => child.path[index] === part),
  ),
));

export function getOpCommandFlags(path: readonly string[], channel: "stable" | "beta" = "stable"): Readonly<Record<string, OpFlagDefinition>> {
  const node = opCatalogNodes.find(entry => entry.path.join(" ") === path.join(" "));
  return Object.freeze(Object.fromEntries(Object.entries({
    ...opGlobalFlags,
    ...(path.length === 0 ? opRootFlags : {}),
    ...node?.flags,
    ...(path.length ? { help: freezeFlag({ ...opGlobalFlags.help!, description: `help for ${path.at(-1)}` }) } : {}),
  }).filter(([, flag]) => channel === "beta" || flag.availability !== "beta")));
}
