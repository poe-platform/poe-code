import json,re,collections
issues=json.load(open('tmp/bun-issues/closed-issues.json'))
include={
'parser-eval': [
 r'\bdestructur',r'optional chain',r'nullish',r'template literal',r'\bspread\b',r'rest (?:parameter|element|property)',
 r'for[ .-]*of',r'for[ .-]*in',r'\bswitch\b',r'try.?catch',r'\bfinally\b',r'\bgenerator',r'\byield\b',
 r'arrow function',r'async function',r'private (?:field|method|identifier)',r'computed propert',r'object literal',
 r'array literal',r'logical assignment',r'optional catch',r'labelled|labeled statement',r'\btypeof\b',r'\bdelete operator',
 r'\bnew operator',r'\bthis binding',r'lexical scope',r'closure',r'temporal dead zone',r'\btdz\b',r'const assignment',
 r'block scop',r'function hoist',r'variable hoist',r'short.?circuit',r'operator precedence',r'comma operator',r'ternary',
 r'getter|setter',r'property descriptor',r'prototype pollution',r'__proto__',r'prototype chain',r'object\.keys',
 r'object\.entries',r'object\.values',r'object\.assign',r'array\.from',r'array\.isarray',r'array\.prototype',
 r'\bmap\b.*(?:iterator|entries|keys|values|foreach|size)',r'\bset\b.*(?:iterator|entries|keys|values|foreach|size)',
 ],
'promise-async': [r'\bpromise',r'\bawait\b',r'\basync\b',r'thenable',r'microtask',r'unhandled rejection',r'promise rejection'],
'errors': [r'error cause',r'aggregateerror',r'error stack',r'stack trace',r'\bthrow\b',r'\bcatch\b',r'custom error',r'error subclass',r'rangeerror',r'typeerror'],
'clone-json': [r'structured.?clone',r'json\.stringify',r'json\.parse',r'circular (?:reference|structure)',r'cyclic object'],
'recursion-memory': [r'maximum call stack',r'stack overflow',r'deep recursion',r'infinite recursion',r'out of memory',r'\boom\b',r'memory leak'],
}
exclude=[
 r'\bbun\.(?:serve|file|write|spawn|build|env|argv|password|gzip|deflate|nanoseconds|which|inspect)',
 r'\bbun (?:install|add|remove|update|upgrade|run|test|build|link|publish|x|create|init)',
 r'package\.json|bun\.lock|bunfig|workspace|monorepo|registry|npm|yarn|pnpm|node_modules|lockfile|dependency|peer dep',
 r'http|websocket|fetch|request|response|headers|cookie|server|socket|tcp|udp|tls|dns|urlpattern',
 r'filesystem|\bfs\b|file descriptor|path\.join|watcher|glob|stream|buffer|blob|formdata',
 r'bundl|transpil|minif|sourcemap|source map|jsx|tsx|typescript|decorator|macro|tree.shak|hmr|hot reload',
 r'commonjs|esm|module resol|dynamic import|require\(|import\.meta|export |import |loader|plugin',
 r'node-api|\bnapi\b|ffi|segfault|segmentation|bus error|illegal instruction|windows|wsl|macos|linux|docker',
 r'redis|sqlite|postgres|s3|crypto|zlib|brotli|web api|dom|react|next|vite|webpack|express|nestjs',
 r'child_process|worker|process\.|console\.|timers?|settimeout|setinterval|performance|date|temporal|regexp|regex',
 r'test runner|expect\(|mock|snapshot test|coverage|cli|shell|terminal|color|stderr|stdout|exit code|signal',
 r'webassembly|wasm|bigint|typedarray|arraybuffer|dataview|sharedarraybuffer|atomics|weakmap|weakset|weakref|symbol',
]
result=[]
for issue in issues:
    title=issue.get('title') or ''
    body=issue.get('body') or ''
    text=title+'\n'+body[:2500]
    cats=[cat for cat,pats in include.items() if any(re.search(p,text,re.I) for p in pats)]
    if not cats: continue
    if any(re.search(p,title,re.I) for p in exclude): continue
    result.append({**issue,'_categories':cats})
json.dump(result,open('tmp/bun-issues/narrow-candidates.json','w'))
with open('tmp/bun-issues/narrow-candidates.tsv','w') as f:
    for i in result:
        f.write(f"{i['number']}\t{','.join(i['_categories'])}\t{i['title'].replace(chr(9),' ').replace(chr(10),' ')}\t{i['html_url']}\n")
print(len(result),collections.Counter(c for i in result for c in i['_categories']))
