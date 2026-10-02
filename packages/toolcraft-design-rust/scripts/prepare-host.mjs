import {copyFileSync,mkdirSync,writeFileSync} from "node:fs";

// Embed the existing own frontmatter adapter and helpers in this standalone addon.
const root=new URL("../",import.meta.url),target=new URL("dist/frontmatter/",root);
mkdirSync(new URL("config/",target),{recursive:true});
copyFileSync(new URL("../frontmatter-rust/src/index.js",root),new URL("index.js",target));
for(const name of ["yaml-snapshot.js","snapshot.js"]){
  copyFileSync(new URL(`../config-mutations-rust/src/${name}`,root),new URL(`config/${name}`,target));
}
writeFileSync(new URL("native.js",target),'import {createRequire} from "node:module";\nexport const native=createRequire(import.meta.url)("../toolcraft-design-rust.node");\n');

for(const name of ["engine.js","data.js"])copyFileSync(new URL(`../toolcraft-template-rust/src/${name}`,root),new URL(`dist/${name}`,root));
