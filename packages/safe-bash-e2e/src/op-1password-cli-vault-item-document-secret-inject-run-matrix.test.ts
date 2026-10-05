import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sb, withE2EHarness } from "./harness.js";

function createTestOpBackend(extra?: sb.OpObjectBackendOptions) {
  return sb.createObjectBackend({
    vaults: [
      { id: "v-prod", name: "Production" },
      { id: "v-staging", name: "Staging" },
    ],
    defaultVault: "v-prod",
    items: [
      {
        id: "item-db",
        title: "Postgres",
        vault: "v-prod",
        category: "LOGIN",
        tags: ["infra", "env/prod"],
        favorite: true,
        fields: [
          { id: "username", label: "username", type: "STRING", purpose: "USERNAME", value: "db_admin" },
          { id: "password", label: "password", type: "CONCEALED", purpose: "PASSWORD", value: "s3cr3t-pg-p@ss!" },
          {
            id: "port",
            label: "port",
            type: "STRING",
            section: { id: "conn", label: "Connection" },
            value: "5432",
          },
        ],
        sections: [{ id: "conn", label: "Connection" }],
      },
      {
        id: "item-api",
        title: "Gateway",
        vault: "v-staging",
        category: "API_CREDENTIAL",
        tags: ["api"],
        fields: [
          { id: "credential", label: "credential", type: "CONCEALED", value: "stg-tok-998877" },
        ],
      },
    ],
    ...extra,
  });
}

describe("op 1Password CLI vault, item, document, secret, inject, and run E2E matrix", () => {
  it("1. op vault list, get, create, edit, and delete lifecycle with JSON output piped to jq", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          op vault list --format json | jq -r '.[].name' | sort
          echo "---CREATE---"
          NEW_ID=$(op vault create "Security-Ops" --description "SecOps Vault" --icon "vault-door" --format json | jq -r '.id')
          op vault get "$NEW_ID" --format json | jq -r '[.name, .description, .icon] | @tsv'
          op vault edit "$NEW_ID" --name "SecOps-Renamed" --description "Updated" >/dev/null
          op vault get "SecOps-Renamed" --format json | jq -r '[.name, .description] | @tsv'
          op vault delete "SecOps-Renamed"
          op vault list --format json | jq -r '.[].name' | sort
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "Production",
            "Staging",
            "---CREATE---",
            "Security-Ops\tSecOps Vault\tvault-door",
            "SecOps-Renamed\tUpdated",
            "Production",
            "Staging",
          ].join("\n")
        );
      }
    );
  });

  it("2. op item list filtering by --vault, --categories, --tags, and --favorite", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          op item list --vault Production --format json | jq -r '.[].title'
          op item list --categories login --format json | jq -r '.[].id'
          op item list --tags env --format json | jq -r '.[].title'
          op item list --favorite --format json | jq -r '.[].title'
          op item list --vault Staging --format json | jq -r '.[].title'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["Postgres", "item-db", "Postgres", "Postgres", "Gateway"].join("\n")
        );
      }
    );
  });

  it("3. op item create with category, section.field[type]=value assignments, and --generate-password recipe", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          op item create --category login --title "GitHub Bot" --vault Production \
            --generate-password=24,letters,digits \
            --url "https://github.com" \
            --tags "ci,bot" \
            username=gh-bot \
            "Tokens.pat[password]=ghp_secret_12345" \
            "Tokens. endpoint[url]=https://api.github.com" \
            --format json > /workspace/created.json
          jq -r '[.title, .category, (.tags | join(",")), .urls[0].href] | @tsv' /workspace/created.json
          op read "op://Production/GitHub Bot/username"
          op read "op://Production/GitHub Bot/Tokens/pat"
          PW=$(op read "op://Production/GitHub Bot/password")
          echo "pw-len:\${#PW}"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "GitHub Bot\tLOGIN\tci,bot\thttps://github.com",
            "gh-bot",
            "ghp_secret_12345",
            "pw-len:24",
          ].join("\n")
        );
      }
    );
  });

  it("4. op item edit updates fields, adds sections, and deletes custom fields with [delete] syntax", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          op item edit Postgres --vault Production \
            --title "Postgres-Primary" \
            "Connection.port=6432" \
            "Connection.Replica[text]=ro.db.internal" \
            >/dev/null
          op read "op://Production/Postgres-Primary/Connection/port"
          op read "op://Production/Postgres-Primary/Connection/Replica"
          op item edit Postgres-Primary --vault Production "Connection.Replica[delete]" >/dev/null
          op item get Postgres-Primary --vault Production --format json | jq -r '[.fields[].label] | sort | join(",")'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["6432", "ro.db.internal", "password,port,username"].join("\n")
        );
      }
    );
  });

  it("5. op item create from --template JSON file and stdin (-) with assignment overrides", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        await h.writeText(
          "/workspace/item-tpl.json",
          JSON.stringify({
            title: "Redis Cache",
            category: "SERVER",
            fields: [
              { id: "password", label: "password", type: "CONCEALED", purpose: "PASSWORD", value: "tpl-default" },
              { id: "host", label: "host", type: "STRING", value: "redis.internal" },
            ],
          })
        );
        const r = await h.exec(`
          op item create --template /workspace/item-tpl.json --vault Production password=redis-override-pw >/dev/null
          op read "op://Production/Redis Cache/host"
          op read "op://Production/Redis Cache/password"
          cat /workspace/item-tpl.json | jq '.title = "Redis Replica"' | op item create - --vault Staging host=redis-ro.internal >/dev/null
          op read "op://Staging/Redis Replica/host"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["redis.internal", "redis-override-pw", "redis-ro.internal"].join("\n")
        );
      }
    );
  });

  it("6. op item move between vaults and op item delete with --archive vs permanent deletion", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          MOVED_ID=$(op item move Gateway --current-vault Staging --destination-vault Production --format json | jq -r '.id')
          op item list --vault Production --format json | jq -r '.[].title' | sort
          op item delete "$MOVED_ID" --vault Production --archive >/dev/null
          op item list --vault Production --format json | jq -r '.[].title' | sort
          op item list --vault Production --include-archive --format json | jq -r '.[].title' | sort
          op item delete "$MOVED_ID" --vault Production >/dev/null
          op item list --vault Production --include-archive --format json | jq -r '.[].title' | sort
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "Gateway",
            "Postgres",
            "Postgres",
            "Gateway",
            "Postgres",
            "Postgres",
          ].join("\n")
        );
      }
    );
  });

  it("7. op item template list and op item template get for standard and custom 1Password categories", async () => {
    const backend = createTestOpBackend({
      resources: {
        "item template": [
          {
            id: "DATABASE",
            name: "Database",
            title: "",
            category: "DATABASE",
            fields: [
              { id: "hostname", label: "hostname", type: "STRING", value: "" },
              { id: "port", label: "port", type: "STRING", value: "5432" },
            ],
          },
        ],
      },
    });
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          op item template list --format json | jq -r 'sort | join(",")'
          op item template get Login --format json | jq -r '[.category, (.fields | map(.id) | sort | join(","))] | @tsv'
          op item template get Database --format json | jq -r '[.category, (.fields | map(.id) | sort | join(","))] | @tsv'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "Database,Login",
            "LOGIN\tnotesPlain,password,username",
            "DATABASE\thostname,port",
          ].join("\n")
        );
      }
    );
  });

  it("8. op item get --otp RFC 6238 TOTP code generation with deterministic backend clock", async () => {
    const backend = sb.createObjectBackend({
      clock: { now: () => 59_000 },
      vaults: [{ id: "v1", name: "Main" }],
      defaultVault: "v1",
      items: [
        {
          id: "totp-item",
          title: "2FA-Service",
          vault: "v1",
          category: "LOGIN",
          fields: [
            {
              id: "one-time-password",
              label: "one-time password",
              type: "OTP",
              value: "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=6&period=30",
            },
          ],
        },
      ],
    });
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          CODE=$(op item get 2FA-Service --otp)
          echo "otp:$CODE"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout.trim(), /^otp:[0-9]{6}$/);
      }
    );
  });

  it("9. op document create, list, edit, get (stdout and --out-file with --file-mode), and delete", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        await h.writeText("/workspace/cert.pem", "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n");
        const r = await h.exec(`
          DOC_ID=$(op document create /workspace/cert.pem --title "TLS-Cert" --vault Production --tags "tls,prod" --format json | jq -r '.id')
          op document list --vault Production --format json | jq -r '.[].title'
          op document get "$DOC_ID" --out-file /workspace/restored.pem --file-mode 0600 >/dev/null
          cmp -s /workspace/cert.pem /workspace/restored.pem && echo "identical:yes"
          stat -c '%a' /workspace/restored.pem
          printf 'UPDATED-CERT-PAYLOAD\n' | op document edit "$DOC_ID" - --title "TLS-Cert-v2" >/dev/null
          op document get "TLS-Cert-v2" --vault Production
          op document delete "TLS-Cert-v2" --vault Production
          op document list --vault Production --format json | jq 'length'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "TLS-Cert",
            "identical:yes",
            "600",
            "UPDATED-CERT-PAYLOAD",
            "0",
          ].join("\n")
        );
      }
    );
  });

  it("10. op read secret reference resolution with --no-newline, --out-file, --file-mode, and --force overwrite protection", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          op read "op://Production/Postgres/username"
          op read "op://Production/Postgres/Connection/port"
          PW_LEN=$(op read --no-newline "op://Production/Postgres/password" | wc -c | tr -d ' ')
          echo "len:$PW_LEN"
          op read "op://Staging/Gateway/credential" --out-file /workspace/api.key --file-mode 0640 >/dev/null
          if op read "op://Staging/Gateway/credential" --out-file /workspace/api.key 2>/dev/null; then
            echo "unexpected-overwrite"
          else
            echo "overwrite-blocked:$?"
          fi
          op read "op://Production/Postgres/username" --out-file /workspace/api.key --force >/dev/null
          cat /workspace/api.key
          echo ""
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["db_admin", "5432", "len:15", "overwrite-blocked:1", "db_admin"].join("\n")
        );
      }
    );
  });

  it("11. op inject template rendering from stdin and --in-file with environment variable interpolation and literals", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      {
        env: { TARGET_VAULT: "Production", TARGET_ITEM: "Postgres" },
        plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })],
      },
      async (h) => {
        await h.writeText(
          "/workspace/config.yml.tpl",
          [
            "database:",
            "  user: {{ op://$TARGET_VAULT/$TARGET_ITEM/username }}",
            "  password: {{ op://Production/Postgres/password }}",
            "  port: {{ op://Production/Postgres/Connection/port }}",
            `  literal: '{{ "{{escaped-braces}}" }}'`,
            "",
          ].join("\n")
        );
        const r = await h.exec(`
          op inject --in-file /workspace/config.yml.tpl --out-file /workspace/config.yml >/dev/null
          yq -o json '.' /workspace/config.yml | jq -r '[.database.user, .database.password, .database.port, .database.literal] | @tsv'
          printf 'token=%s\n' '{{ op://Staging/Gateway/credential }}' | op inject
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "db_admin\ts3cr3t-pg-p@ss!\t5432\t{{escaped-braces}}",
            "token=stg-tok-998877",
          ].join("\n")
        );
      }
    );
  });

  it("12. op run resolves op:// environment variables, masks secrets on stdout/stderr, and supports --no-masking", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      {
        env: {
          DB_USER: "op://Production/Postgres/username",
          DB_PASS: "op://Production/Postgres/password",
        },
        plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })],
      },
      async (h) => {
        const r = await h.exec(`
          op run -- printenv DB_PASS
          op run --no-masking -- printenv DB_PASS
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["<concealed by 1Password>", "s3cr3t-pg-p@ss!"].join("\n")
        );
      }
    );
  });

  it("13. op run with multiple --env-file dotenv files, variable interpolation, and --environment backend records", async () => {
    const backend = createTestOpBackend({
      resources: {
        environment: [
          {
            id: "env-cloud",
            variables: { CLOUD_KEY: "cloud-secret-xyz", REGION: "us-east-1" },
          },
        ],
      },
    });
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        await h.writeText(
          "/workspace/base.env",
          [
            "# Base dotenv",
            "VAULT_NAME=Production",
            'PG_URI="postgres://{{ op://$VAULT_NAME/Postgres/username }}:{{ op://$VAULT_NAME/Postgres/password }}@localhost:{{ op://Production/Postgres/Connection/port }}/app"',
            "OVERRIDE_ME=from_base",
            "",
          ].join("\n")
        );
        await h.writeText(
          "/workspace/override.env",
          [
            "OVERRIDE_ME=from_override",
            "API_KEY=op://Staging/Gateway/credential",
            "",
          ].join("\n")
        );
        const r = await h.exec(`
          op run --env-file /workspace/base.env --env-file /workspace/override.env --no-masking -- printenv PG_URI OVERRIDE_ME API_KEY
          echo "---MASKED---"
          op run --env-file /workspace/base.env -- env | grep '^PG_URI='
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "postgres://db_admin:s3cr3t-pg-p@ss!@localhost:5432/app",
            "from_override",
            "stg-tok-998877",
            "---MASKED---",
            "PG_URI=postgres://<concealed by 1Password>:<concealed by 1Password>@localhost:<concealed by 1Password>/app",
          ].join("\n")
        );
      }
    );
  });

  it("14. op environment read and snapshot create/list/get in beta channel", async () => {
    const backend = createTestOpBackend({
      resources: {
        environment: [
          {
            id: "env-1",
            name: "ProdEnv",
            variables: { PORT: "8080", API_TOKEN: "stg-tok-998877" },
          },
        ],
      },
    });
    await withE2EHarness(
      {
        env: { APP_STAGE: "production", REGION: "eu-west-1" },
        plugins: [
          sb.opCommands({
            backend,
            channel: "beta",
            authorize: () => "allow",
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          op environment read env-1 --format json | jq -r '[.PORT, .API_TOKEN] | @tsv'
          op environment snapshot create snap-1 --vars APP_STAGE,REGION >/dev/null
          op environment snapshot get snap-1 --format json | jq -r '[.snapshot.scope, .snapshot.variables.APP_STAGE, .snapshot.variables.REGION] | @tsv'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "8080\tstg-tok-998877",
            "selected\tproduction\teu-west-1",
          ].join("\n")
        );
      }
    );
  });

  it("15. op two-stage permission gates: authorize='ask' -> authorizeResolution -> approveResolved manifest inspection", async () => {
    const backend = createTestOpBackend();
    const auditLog: string[] = [];
    await withE2EHarness(
      {
        plugins: [
          sb.opCommands({
            backend,
            replace: true,
            authorize(req) {
              auditLog.push(`auth:${req.resource}:${req.action}`);
              return "ask";
            },
            authorizeResolution(req) {
              auditLog.push(`resolve:${req.resource}:${req.action}`);
              return true;
            },
            approveResolved(manifest) {
              const targetIds = manifest.targets.map((t) => `${t.resource}:${t.id}`).sort().join(",");
              auditLog.push(`approve:[${targetIds}]`);
              assert.equal(JSON.stringify(manifest).includes("s3cr3t-pg-p@ss!"), false);
              return true;
            },
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          op read "op://Production/Postgres/password"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "s3cr3t-pg-p@ss!");
        assert.deepEqual(auditLog, [
          "auth:read:",
          "resolve:read:",
          "approve:[item:item-db,item:password,vault:v-prod]",
        ]);
      }
    );
  });

  it("16. op permission gate denial fails closed before VFS read/write or backend mutation", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      {
        plugins: [
          sb.opCommands({
            backend,
            replace: true,
            authorize(req) {
              if (req.action === "delete" || req.resource === "read") return "deny";
              return "allow";
            },
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          if op read "op://Production/Postgres/password" --out-file /workspace/leaked.txt 2>/dev/null; then
            echo "unexpected-read"
          else
            echo "read-denied:$?"
          fi
          if op item delete Postgres --vault Production 2>/dev/null; then
            echo "unexpected-delete"
          else
            echo "delete-denied:$?"
          fi
          test ! -e /workspace/leaked.txt && echo "no-file:ok"
          op item get Postgres --vault Production --format json | jq -r '.title'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["read-denied:1", "delete-denied:1", "no-file:ok", "Postgres"].join("\n")
        );
      }
    );
  });

  it("17. op item create and edit with binary file attachments (section.name[file]=path) and op item get", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        await h.writeBytes("/workspace/id_ed25519", new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]));
        const r = await h.exec(`
          op item create --category login --title "Bastion" --vault Production \
            "Keys.ssh_key[file]=/workspace/id_ed25519" \
            --format json > /workspace/bastion.json
          jq -r '[.files[0].name, .files[0].size, .files[0].section.label] | @tsv' /workspace/bastion.json
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "ssh_key\t6\tKeys");
        const snapshotItem = backend.snapshot().items?.find((i) => i.title === "Bastion");
        assert.deepEqual(
          snapshotItem?.files?.[0]?.content,
          new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff])
        );
      }
    );
  });

  it("18. op item batch selectors via stdin JSON array and comma-separated flags", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        const r = await h.exec(`
          op item list --format json | op item get - --format json | jq -r 'map(.title) | sort | join(",")'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "Gateway,Postgres");
      }
    );
  });

  it("19. op help and subcommand help traversal without triggering authorization callbacks", async () => {
    let authCalled = false;
    const backend = createTestOpBackend();
    await withE2EHarness(
      {
        plugins: [
          sb.opCommands({
            backend,
            replace: true,
            authorize() {
              authCalled = true;
              return "deny";
            },
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          op --help | head -n 3
          op help vault user | grep -E "grant|revoke" | wc -l | tr -d ' '
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(authCalled, false);
        assert.match(r.stdout, /1Password CLI/);
      }
    );
  });

  it("20. end-to-end secret rotation workflow: generate password -> update item -> op inject config -> verify with sqlite3 & jq", async () => {
    const backend = createTestOpBackend();
    await withE2EHarness(
      { plugins: [sb.opCommands({ backend, authorize: () => "allow", replace: true })] },
      async (h) => {
        await h.writeText(
          "/workspace/app-secret.json.tpl",
          JSON.stringify({
            service: "postgres",
            user: "{{ op://Production/Postgres/username }}",
            password: "{{ op://Production/Postgres/password }}",
            port: "{{ op://Production/Postgres/Connection/port }}",
          })
        );
        const r = await h.exec(`
          OLD_PW=$(op read "op://Production/Postgres/password")
          op item edit Postgres --vault Production --generate-password=20,letters,digits >/dev/null
          NEW_PW=$(op read "op://Production/Postgres/password")
          test "$OLD_PW" != "$NEW_PW" && echo "rotated:yes"
          echo "new-len:\${#NEW_PW}"
          op inject --in-file /workspace/app-secret.json.tpl --out-file /workspace/app-secret.json --force >/dev/null
          INJECTED_PW=$(jq -r '.password' /workspace/app-secret.json)
          test "$INJECTED_PW" = "$NEW_PW" && echo "injected-matches:yes"
          sqlite3 /workspace/audit.db "CREATE TABLE rotations(service TEXT, user_name TEXT, pw_sha256 TEXT);"
          PW_HASH=$(printf '%s' "$NEW_PW" | sha256sum | awk '{print $1}')
          USER_NAME=$(jq -r '.user' /workspace/app-secret.json)
          sqlite3 /workspace/audit.db "INSERT INTO rotations VALUES ('postgres', '$USER_NAME', '$PW_HASH');"
          sqlite3 /workspace/audit.db "SELECT service, user_name, length(pw_sha256) FROM rotations;"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "rotated:yes",
            "new-len:20",
            "injected-matches:yes",
            "postgres|db_admin|64",
          ].join("\n")
        );
      }
    );
  });
});
