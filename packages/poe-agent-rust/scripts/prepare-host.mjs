import { mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
const root = new URL("../", import.meta.url),
  dist = new URL("dist/", root);
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(new URL("src/", root)))
  if (name.endsWith(".d.ts")) copyFileSync(new URL("src/" + name, root), new URL(name, dist));

copyFileSync(
  new URL("../poe-acp-client-rust/src/types.d.ts", root),
  new URL("acp-types.d.ts", dist)
);

const clientSource = new URL("../tiny-mcp-client-rust/src/", root),
  clientOutput = new URL("client/", dist),
  oauthOutput = new URL("oauth/", clientOutput);
mkdirSync(clientOutput, { recursive: true });
mkdirSync(oauthOutput, { recursive: true });
for (const name of readdirSync(clientSource)) {
  if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
  let text = readFileSync(new URL(name, clientSource), "utf8").replaceAll(
    "./tiny-mcp-client-rust.node",
    "../poe-agent-rust.node"
  );
  if (name.endsWith(".d.ts")) {
    const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const transformed = ts.transform(file, [
      (context) => (node) =>
        ts.visitNode(node, function visit(child) {
          if (ts.isStringLiteral(child) && child.text === "tiny-stdio-mcp-server-rust")
            return ts.factory.createStringLiteral("./stdio-server.js");
          return ts.visitEachChild(child, visit, context);
        })
    ]);
    try {
      text = ts.createPrinter().printFile(transformed.transformed[0]);
    } finally {
      transformed.dispose();
    }
  }
  writeFileSync(new URL(name, clientOutput), text);
}
copyFileSync(
  new URL("../tiny-stdio-mcp-server-rust/src/index.d.ts", root),
  new URL("stdio-server.d.ts", clientOutput)
);
const oauthSource = new URL("../mcp-oauth-rust/src/", root);
for (const name of readdirSync(oauthSource))
  if (name.endsWith(".js") || name.endsWith(".d.ts"))
    writeFileSync(
      new URL(name, oauthOutput),
      readFileSync(new URL(name, oauthSource), "utf8").replaceAll(
        "./mcp-oauth-rust.node",
        "../../poe-agent-rust.node"
      )
    );
for (const [from, to] of [
  ["runtime.js", "auth-store-runtime.js"],
  ["credential-transaction-lock.js", "credential-transaction-lock.js"],
  ["index.d.ts", "auth-store-types.d.ts"]
])
  copyFileSync(new URL("../auth-store-rust/src/" + from, root), new URL(to, oauthOutput));

copyFileSync(new URL("src/SYSTEM_PROMPT.md", root), new URL("SYSTEM_PROMPT.md", dist));

const acpSource = new URL("../poe-acp-client-rust/src/", root),
  acpOutput = new URL("acp/", dist);
mkdirSync(acpOutput, { recursive: true });
for (const name of readdirSync(acpSource))
  if (name.endsWith(".js") || name.endsWith(".d.ts"))
    writeFileSync(
      new URL(name, acpOutput),
      readFileSync(new URL(name, acpSource), "utf8").replaceAll(
        "./poe-acp-client-rust.node",
        "../poe-agent-rust.node"
      )
    );
for (const name of ["index.js", "index.d.ts"])
  writeFileSync(
    new URL(name === "index.js" ? "user-error.js" : "user-error.d.ts", dist),
    readFileSync(new URL("../user-error-rust/src/" + name, root), "utf8").replaceAll(
      "./user-error-rust.node",
      "./poe-agent-rust.node"
    )
  );

writeFileSync(
  new URL("session-update-types.d.ts", dist),
  readFileSync(new URL("../agent-spawn-rust/src/acp-types.d.ts", root), "utf8").replaceAll(
    "./acp-protocol-types.js",
    "./acp-types.js"
  )
);

for (const name of ["run-command.js", "run-command.d.ts"])
  copyFileSync(new URL("../agent-spawn-rust/src/" + name, root), new URL("spawn-" + name, dist));
