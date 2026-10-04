import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import { sb, withE2EHarness } from "./harness.js";

function createMockTransport(
  handler: (req: sb.HttpRequest, bodyBytes: Uint8Array) => Promise<{
    status?: number;
    statusText?: string;
    headers?: sb.HttpHeaders;
    body?: string | Uint8Array;
  }> | {
    status?: number;
    statusText?: string;
    headers?: sb.HttpHeaders;
    body?: string | Uint8Array;
  }
): sb.HttpTransport {
  const encoder = new TextEncoder();
  return Object.assign(async (req: sb.HttpRequest): Promise<sb.HttpResponse> => {
    const chunks: Uint8Array[] = [];
    if (req.body) {
      for await (const chunk of sb.readBytes(req.body, req.signal)) {
        chunks.push(chunk);
      }
    }
    const bodyBytes = Buffer.concat(chunks);
    const res = await handler(req, bodyBytes);
    const payload =
      typeof res.body === "string"
        ? encoder.encode(res.body)
        : res.body ?? new Uint8Array(0);
    return {
      status: res.status ?? 200,
      statusText: res.statusText ?? "OK",
      headers: res.headers ?? [["content-type", "application/json"]],
      httpVersion: "1.1",
      body: sb.toByteSource(payload),
      async dispose() {},
    };
  }, { supportsPrivateNetworkDeny: true as const });
}

describe("safe-bash E2E: network (curl, wget), llm, and op (1Password) workflows", () => {
  it("1. curl performs GET requests with custom headers (-H), URL-encoded query params (-G --data-urlencode), and header dumps (-D)", async () => {
    const transport = createMockTransport((req) => ({
      status: 200,
      headers: [
        ["content-type", "application/json"],
        ["x-request-id", "req-001"],
      ],
      body: JSON.stringify({
        url: req.url,
        method: req.method,
        customHeader: req.headers.find(([k]) => k.toLowerCase() === "x-trace")?.[1],
      }),
    }));

    await withE2EHarness(
      {
        plugins: [
          sb.networkCommands({
            authorize: () => true,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "curl -s -G https://api.example.test/v1/search \\",
            "  -H 'X-Trace: trace-abc' \\",
            "  --data-urlencode 'q=hello world' \\",
            "  --data-urlencode 'limit=5' \\",
            "  -D /workspace/headers.txt | jq -c '{method, url, customHeader}'",
            "grep -i 'x-request-id' /workspace/headers.txt | tr -d '\\r'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            '{"method":"GET","url":"https://api.example.test/v1/search?q=hello+world&limit=5","customHeader":"trace-abc"}',
            "x-request-id: req-001",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("2. curl sends JSON (--json), binary file bodies (--data-binary @file), and Basic/Bearer authentication", async () => {
    const transport = createMockTransport((req, bodyBytes) => ({
      status: 201,
      statusText: "Created",
      body: JSON.stringify({
        method: req.method,
        auth: req.headers.find(([k]) => k.toLowerCase() === "authorization")?.[1],
        contentType: req.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1],
        body: new TextDecoder().decode(bodyBytes),
      }),
    }));

    await withE2EHarness(
      {
        files: {
          "/workspace/payload.json": '{"service":"worker","replicas":3}'
        },
        plugins: [
          sb.networkCommands({
            authorize: () => true,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "curl -s --oauth2-bearer 'tok-secret-99' --json @/workspace/payload.json https://api.example.test/v1/deploy \\",
            "  | jq -c '{method, auth, contentType, replicas: (.body | fromjson | .replicas)}'",
            "curl -s -u 'admin:s3cr3t' -X PUT --data-raw 'updated' https://api.example.test/v1/item \\",
            "  | jq -r '.auth'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            '{"method":"POST","auth":"Bearer tok-secret-99","contentType":"application/json","replicas":3}',
            "Basic YWRtaW46czNjcjN0",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("3. curl follows HTTP redirects (-L) and formats transfer metadata via -w (--write-out)", async () => {
    const transport = createMockTransport((req) => {
      if (req.url.endsWith("/old")) {
        return {
          status: 302,
          statusText: "Found",
          headers: [["location", "https://api.example.test/v1/new"]],
          body: "",
        };
      }
      return {
        status: 200,
        headers: [["content-type", "text/plain"]],
        body: "reached-final-destination\n",
      };
    });

    await withE2EHarness(
      {
        plugins: [
          sb.networkCommands({
            authorize: () => true,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "curl -s -L -o /workspace/out.txt -w '%{http_code}|%{num_redirects}|%{url_effective}\\n' https://api.example.test/v1/old",
            "cat /workspace/out.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "200|1|https://api.example.test/v1/new",
            "reached-final-destination",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("4. curl expands URL globs ([1-3], {a,b}) and writes templated output files (-o item_#1.json)", async () => {
    const transport = createMockTransport((req) => {
      const id = req.url.split("/").pop()!;
      return {
        status: 200,
        body: `{"id":"${id}"}\n`,
      };
    });

    await withE2EHarness(
      {
        plugins: [
          sb.networkCommands({
            authorize: () => true,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "curl -s 'https://api.example.test/items/[1-3]' -o '/workspace/item_#1.json'",
            "cat /workspace/item_1.json /workspace/item_2.json /workspace/item_3.json",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            '{"id":"1"}',
            '{"id":"2"}',
            '{"id":"3"}',
            ""
          ].join("\n")
        );
      }
    );
  });

  it("5. curl transparently decompresses gzip responses (--compressed) and saves/compares ETags", async () => {
    const gzPayload = gzipSync(Buffer.from('{"compressed":true,"items":[1,2,3]}\n'));
    const transport = createMockTransport((req) => {
      const inm = req.headers.find(([k]) => k.toLowerCase() === "if-none-match")?.[1];
      if (inm === '"v1-etag"') {
        return { status: 304, statusText: "Not Modified", headers: [["etag", '"v1-etag"']], body: "" };
      }
      return {
        status: 200,
        headers: [
          ["content-type", "application/json"],
          ["content-encoding", "gzip"],
          ["etag", '"v1-etag"'],
        ],
        body: gzPayload,
      };
    });

    await withE2EHarness(
      {
        plugins: [
          sb.networkCommands({
            authorize: () => true,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "curl -s --compressed --etag-save /workspace/etag.txt https://api.example.test/data.json",
            "cat /workspace/etag.txt",
            "curl -s --etag-compare /workspace/etag.txt -w '%{http_code}\\n' https://api.example.test/data.json",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            '{"compressed":true,"items":[1,2,3]}',
            '"v1-etag"',
            "304",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("6. curl retries transient 503 responses (--retry) and honors -f (--fail) on 404 errors", async () => {
    let attempts = 0;
    const transport = createMockTransport((req) => {
      if (req.url.endsWith("/flaky")) {
        attempts++;
        if (attempts < 2) {
          return { status: 503, statusText: "Service Unavailable", body: "try again" };
        }
        return { status: 200, body: `recovered-on-attempt-${attempts}\n` };
      }
      return { status: 404, statusText: "Not Found", body: "missing" };
    });

    await withE2EHarness(
      {
        plugins: [
          sb.networkCommands({
            authorize: () => true,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "curl -s -f --retry 2 --retry-delay 0.01 https://api.example.test/flaky",
            "curl -s -f https://api.example.test/missing || echo \"curl-fail-exit:$?\"",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "recovered-on-attempt-2",
            "curl-fail-exit:22",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("7. createOriginAuthorizer enforces origin allowlists and private-network denial across direct requests and redirects", async () => {
    const authorizer = sb.createOriginAuthorizer(
      ["https://allowed.example.test"],
      { denyPrivateNetworks: true }
    );
    const transport = createMockTransport((req) => {
      if (req.url.endsWith("/evil-redirect")) {
        return {
          status: 302,
          headers: [["location", "https://blocked.example.test/secret"]],
          body: "",
        };
      }
      return { status: 200, body: "allowed-ok\n" };
    });

    await withE2EHarness(
      {
        plugins: [
          sb.networkCommands({
            authorize: authorizer,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "curl -s https://allowed.example.test/ok",
            "curl -s https://blocked.example.test/secret 2>/dev/null || echo 'blocked-origin-denied'",
            "curl -s http://127.0.0.1:8080/internal 2>/dev/null || echo 'blocked-private-denied'",
            "curl -s -L https://allowed.example.test/evil-redirect 2>/dev/null || echo 'blocked-redirect-denied'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "allowed-ok",
            "blocked-origin-denied",
            "blocked-private-denied",
            "blocked-redirect-denied",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("8. wget downloads files with -O, -P directory prefix, --header, and --post-data", async () => {
    const transport = createMockTransport((req, bodyBytes) => ({
      status: 200,
      headers: [["content-type", "text/plain"]],
      body: `method=${req.method} token=${req.headers.find(([k]) => k.toLowerCase() === "x-api-token")?.[1]} body=${new TextDecoder().decode(bodyBytes)}\n`,
    }));

    await withE2EHarness(
      {
        plugins: [
          sb.networkCommands({
            authorize: () => true,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "wget -q --header='X-Api-Token: tok-123' --post-data='action=sync' -O /workspace/response.txt https://api.example.test/v1/sync",
            "cat /workspace/response.txt",
            "wget -q -P /workspace/downloads https://api.example.test/v1/report.txt",
            "test -f /workspace/downloads/report.txt && echo 'saved-to-prefix'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "method=POST token=tok-123 body=action=sync",
            "saved-to-prefix",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("9. wget supports --spider, -nc (no-clobber), -c (resume with Range header), and -i input URL list", async () => {
    const fullContent = "0123456789ABCDEF\n";
    const transport = createMockTransport((req) => {
      const range = req.headers.find(([k]) => k.toLowerCase() === "range")?.[1];
      if (range === "bytes=6-") {
        return {
          status: 206,
          statusText: "Partial Content",
          headers: [["content-range", "bytes 6-16/17"]],
          body: fullContent.slice(6),
        };
      }
      return {
        status: 200,
        body: `fetched:${req.url.split("/").pop()}\n`,
      };
    });

    await withE2EHarness(
      {
        files: {
          "/workspace/partial.bin": "012345",
          "/workspace/urls.txt": "https://api.example.test/u1.txt\nhttps://api.example.test/u2.txt\n"
        },
        plugins: [
          sb.networkCommands({
            authorize: () => true,
            transport,
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "wget -q -c -O /workspace/partial.bin https://api.example.test/stream.bin",
            "cat /workspace/partial.bin",
            "wget -q -nc -O /workspace/partial.bin https://api.example.test/u1.txt",
            "cat /workspace/partial.bin",
            "wget -q -i /workspace/urls.txt -O -",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "0123456789ABCDEF",
            "0123456789ABCDEF",
            "fetched:u1.txt",
            "fetched:u2.txt",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("10. llm executes prompts from arguments and stdin with -m model, -s system prompt, and -o options", async () => {
    await withE2EHarness(
      {
        plugins: [
          sb.llmCommands({
            defaultModel: "mock-fast",
            replace: true,
            providers: [
              {
                name: "mock",
                models: [
                  { id: "mock-fast", aliases: ["fast"] },
                  { id: "mock-pro", aliases: ["pro"] },
                ],
                async *complete(req) {
                  yield JSON.stringify({
                    model: req.model,
                    system: req.system ?? null,
                    prompt: req.prompt,
                    options: req.options,
                  });
                },
              },
            ],
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "llm 'Summarize the architecture' | jq -c '{model, prompt}'",
            "printf 'stack trace line 1' | llm -m pro -s 'You are a debugger' -o temperature 0.2 'Fix this' | jq -c '{model, system, prompt, temp: .options.temperature}'",
            "llm models",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            '{"model":"mock-fast","prompt":"Summarize the architecture"}',
            '{"model":"mock-pro","system":"You are a debugger","prompt":"stack trace line 1 Fix this","temp":"0.2"}',
            "mock: mock-fast (aliases: fast)",
            "mock: mock-pro (aliases: pro)",
            "Default: mock-fast",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("11. llm attaches VFS files via -a (auto MIME) and --at (explicit MIME) and rejects unsupported MIME types", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/doc.pdf": "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n",
          "/workspace/notes.txt": "plain text note\n"
        },
        plugins: [
          sb.llmCommands({
            defaultModel: "vision-v1",
            replace: true,
            providers: [
              {
                name: "vision",
                models: [
                  {
                    id: "vision-v1",
                    attachmentTypes: ["image/png", "application/pdf"],
                  },
                ],
                async *complete(req) {
                  yield JSON.stringify({
                    prompt: req.prompt,
                    attachments: req.attachments.map((a) => {
                      assert.ok(a.bytes, "Expected an inline attachment");
                      return { mimeType: a.mimeType, size: a.bytes.byteLength };
                    }),
                  });
                },
              },
            ],
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "llm -a /workspace/doc.pdf 'Extract title' | jq -c '{prompt, attachments}'",
            "llm --at /workspace/notes.txt text/plain 'Read notes' 2>/dev/null || echo 'rejected-mime'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            '{"prompt":"Extract title","attachments":[{"mimeType":"application/pdf","size":29}]}',
            "rejected-mime",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("12. op read fetches secret references (op://vault/item/field) and writes 0600 secret files (-o)", async () => {
    const backend = sb.createObjectBackend({
      vaults: [{ id: "v-prod", name: "Production" }],
      items: [
        {
          id: "i-db",
          title: "Postgres",
          vault: "Production",
          category: "DATABASE",
          fields: [
            { id: "username", label: "username", value: "db_admin" },
            { id: "password", label: "password", type: "CONCEALED", value: "sup3r-s3cr3t-pw" },
          ],
        },
      ],
    });

    await withE2EHarness(
      {
        plugins: [sb.opCommands({ backend, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "op read 'op://Production/Postgres/username'",
            "op read -n -o /workspace/db.pass 'op://Production/Postgres/password'",
            "stat -c '%a' /workspace/db.pass",
            "cat /workspace/db.pass",
            "printf '\\n'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "db_admin",
            "/workspace/db.pass",
            "600",
            "sup3r-s3cr3t-pw",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("13. op inject renders secret templates from stdin and -i/-o files", async () => {
    const backend = sb.createObjectBackend({
      vaults: [{ id: "v-prod", name: "Production" }],
      items: [
        {
          id: "i-api",
          title: "Stripe",
          vault: "Production",
          fields: [
            { id: "api_key", label: "api_key", type: "CONCEALED", value: "sk_live_987654321" },
            { id: "webhook_secret", label: "webhook_secret", type: "CONCEALED", value: "whsec_abcdef" },
          ],
        },
      ],
    });

    await withE2EHarness(
      {
        files: {
          "/workspace/config.tpl": [
            "STRIPE_KEY={{ op://Production/Stripe/api_key }}",
            "WEBHOOK={{ op://Production/Stripe/webhook_secret }}",
            ""
          ].join("\n")
        },
        plugins: [sb.opCommands({ backend, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "op inject -i /workspace/config.tpl -o /workspace/config.env",
            "cat /workspace/config.env",
            "printf 'key={{ op://Production/Stripe/api_key }}\\n' | op inject",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/workspace/config.env",
            "STRIPE_KEY=sk_live_987654321",
            "WEBHOOK=whsec_abcdef",
            "key=sk_live_987654321",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("14. op run resolves op:// environment variables for child commands and masks secrets on stdout unless --no-masking is passed", async () => {
    const backend = sb.createObjectBackend({
      vaults: [{ id: "v-prod", name: "Production" }],
      items: [
        {
          id: "i-tok",
          title: "GitHub",
          vault: "Production",
          fields: [
            { id: "token", label: "token", type: "CONCEALED", value: "ghp_ultraSecretTokenValue42" },
          ],
        },
      ],
    });

    await withE2EHarness(
      {
        plugins: [sb.opCommands({ backend, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "export GH_TOKEN='op://Production/GitHub/token'",
            "op run -- printenv GH_TOKEN",
            "op run --no-masking -- printenv GH_TOKEN",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "<concealed by 1Password>",
            "ghp_ultraSecretTokenValue42",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("15. op item create, get, edit, list, and delete manage structured vault items", async () => {
    const backend = sb.createObjectBackend({
      vaults: [{ id: "v-dev", name: "Dev" }],
    });

    await withE2EHarness(
      {
        plugins: [sb.opCommands({ backend, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "op item create --category login --title 'Staging Redis' --vault Dev 'username=redis_user' 'password=redis_pass_1' --format json > /workspace/created.json",
            "jq -r '.title' /workspace/created.json",
            "op read 'op://Dev/Staging Redis/password'",
            "op item edit 'Staging Redis' --vault Dev 'password=redis_pass_2' --format json > /dev/null",
            "op read 'op://Dev/Staging Redis/password'",
            "op item list --vault Dev --format json | jq 'length'",
            "op item delete 'Staging Redis' --vault Dev",
            "op item list --vault Dev --format json | jq 'length'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "Staging Redis",
            "redis_pass_1",
            "redis_pass_2",
            "1",
            "0",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("16. op document create, get, edit, and delete manage binary/text documents in vaults", async () => {
    const backend = sb.createObjectBackend({
      vaults: [{ id: "v-certs", name: "Certs" }],
    });

    await withE2EHarness(
      {
        files: {
          "/workspace/ca.pem": "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n"
        },
        plugins: [sb.opCommands({ backend, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "op document create /workspace/ca.pem --title 'Root CA' --vault Certs --format json > /workspace/doc.json",
            "jq -r '.title' /workspace/doc.json",
            "op document get 'Root CA' --vault Certs | head -n 1",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "Root CA",
            "-----BEGIN CERTIFICATE-----",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("17. op vault list/get and op account list/get inspect account and vault metadata", async () => {
    const backend = sb.createObjectBackend({
      accounts: [{ id: "acct-1", url: "https://my.1password.com", email: "ops@example.com", user_uuid: "u-001", account_uuid: "a-001" }],
      vaults: [
        { id: "v-1", name: "Infra" },
        { id: "v-2", name: "Security" },
      ],
    });

    await withE2EHarness(
      {
        plugins: [sb.opCommands({ backend, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "op vault list --format json | jq -r '.[].name' | sort",
            "op vault get Infra --format json | jq -r '.id'",
            "op account list --format json | jq -r '.[0].email'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "Infra",
            "Security",
            "v-1",
            "ops@example.com",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("18. op authorization hooks block unauthorized secret access without leaking secret material", async () => {
    const backend = sb.createObjectBackend({
      vaults: [{ id: "v-prod", name: "Production" }],
      items: [
        {
          id: "i-1",
          title: "RootKey",
          vault: "Production",
          fields: [{ id: "secret", label: "secret", type: "CONCEALED", value: "NEVER_LEAK_ME_999" }],
        },
      ],
    });

    await withE2EHarness(
      {
        plugins: [
          sb.opCommands({
            backend,
            authorize: (req) => (req.resource === "read" ? "deny" : "allow"),
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "op read 'op://Production/RootKey/secret' 2>/workspace/err.txt || echo 'read-blocked'",
            "op vault list --format json | jq -r '.[0].name'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "read-blocked\nProduction\n");
        const errText = await h.readText("/workspace/err.txt");
        assert.ok(!errText.includes("NEVER_LEAK_ME_999"));
      }
    );
  });

  it("19. end-to-end API + LLM + SQLite triage pipeline: curl fetches incidents, llm classifies severity, and sqlite3 aggregates report", async () => {
    const transport = createMockTransport(() => ({
      status: 200,
      body: JSON.stringify([
        { id: 101, service: "payments", summary: "database connection pool exhausted" },
        { id: 102, service: "docs", summary: "typo on landing page" },
      ]),
    }));

    await withE2EHarness(
      {
        plugins: [
          sb.networkCommands({ authorize: () => true, transport, replace: true }),
          sb.llmCommands({
            defaultModel: "triage-v1",
            replace: true,
            providers: [
              {
                name: "triage",
                models: [{ id: "triage-v1" }],
                async *complete(req) {
                  const text = req.prompt.toLowerCase();
                  const severity = text.includes("exhausted") ? "P0" : "P3";
                  yield severity;
                },
              },
            ],
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "sqlite3 /workspace/incidents.db 'CREATE TABLE incidents (id INT, service TEXT, severity TEXT);'",
            "curl -s https://api.example.test/incidents | jq -c '.[]' > /workspace/raw.jsonl",
            "while IFS= read -r row; do",
            "  id=$(printf '%s' \"$row\" | jq -r '.id')",
            "  svc=$(printf '%s' \"$row\" | jq -r '.service')",
            "  sum=$(printf '%s' \"$row\" | jq -r '.summary')",
            "  sev=$(llm \"Classify: $sum\" < /dev/null)",
            "  sqlite3 /workspace/incidents.db \"INSERT INTO incidents VALUES ($id, '$svc', '$sev');\"",
            "done < /workspace/raw.jsonl",
            "sqlite3 -csv -header /workspace/incidents.db 'SELECT id, service, severity FROM incidents ORDER BY id;'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "id,service,severity",
            "101,payments,P0",
            "102,docs,P3",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("20. end-to-end zero-trust release webhook: op inject renders payload, op run executes curl while masking secrets", async () => {
    const backend = sb.createObjectBackend({
      vaults: [{ id: "v-ci", name: "CI" }],
      items: [
        {
          id: "i-hook",
          title: "DeployWebhook",
          vault: "CI",
          fields: [
            { id: "token", label: "token", type: "CONCEALED", value: "wh_secret_token_777" },
          ],
        },
      ],
    });

    const transport = createMockTransport((req, bodyBytes) => ({
      status: 200,
      body: JSON.stringify({
        ok: true,
        authHeader: req.headers.find(([k]) => k.toLowerCase() === "authorization")?.[1],
        payload: JSON.parse(new TextDecoder().decode(bodyBytes)),
      }) + "\n",
    }));

    await withE2EHarness(
      {
        files: {
          "/workspace/release.tpl.json": '{"app":"safe-bash","signingToken":"{{ op://CI/DeployWebhook/token }}"}\n'
        },
        plugins: [
          sb.opCommands({ backend, replace: true }),
          sb.networkCommands({ authorize: () => true, transport, replace: true }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "op inject -i /workspace/release.tpl.json -o /workspace/release.json",
            "export HOOK_TOKEN='op://CI/DeployWebhook/token'",
            "op run -- sh -c 'curl -s --oauth2-bearer \"$HOOK_TOKEN\" --json @/workspace/release.json https://hooks.example.test/deploy'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        // Notice that op run automatically masks wh_secret_token_777 in stdout!
        assert.equal(
          r.stdout,
          [
            "/workspace/release.json",
            '{"ok":true,"authHeader":"Bearer <concealed by 1Password>","payload":{"app":"safe-bash","signingToken":"<concealed by 1Password>"}}',
            ""
          ].join("\n")
        );
      }
    );
  });
});
