"""Generate portable types and validation data from the versioned wire schema."""
import json
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[3]
source = Path(__file__).resolve().parents[1] / 'schemas/v1'
documents = {name: json.loads((source / name).read_text())
             for name in ['protocol.schema.json', 'canonical-filesystem.schema.json',
                          'streaming-profile.schema.json', 'dependency-manifest.schema.json']}
schema = documents['protocol.schema.json']
canonical_schema = documents['canonical-filesystem.schema.json']
streaming_schema = documents['streaming-profile.schema.json']
# Resolve only trusted, local documents. Definition names belong to their source
# schema; dependency Blob/Entry/Id must not replace the generic wire models.
names = {}
used = set(schema['$defs']) | set(canonical_schema['$defs']) | set(streaming_schema['$defs'])
for owner, document in documents.items():
    names[owner] = {name: ('DependencyProfile'+name if owner == 'dependency-manifest.schema.json' and name in used else name)
                    for name in document['$defs']}
aliases = {document['$id']: owner for owner, document in documents.items()}
aliases.update({owner: owner for owner in documents})
def local_refs(value, owner):
    if isinstance(value, list): return [local_refs(v, owner) for v in value]
    if not isinstance(value, dict): return value
    result = {k: local_refs(v, owner) for k, v in value.items() if k != '$ref'}
    if '$ref' not in value: return result
    location, fragment = value['$ref'].split('#', 1)
    referenced_owner = owner if not location else aliases.get(location)
    if referenced_owner is None: raise SystemExit('Unknown versioned schema reference: '+value['$ref'])
    parts = [part.replace('~1', '/').replace('~0', '~') for part in fragment.split('/')[1:]]
    if len(parts) < 2 or parts[0] != '$defs': raise SystemExit('Unsupported schema pointer: '+value['$ref'])
    if len(parts) == 2:
        result['$ref'] = '#/$defs/'+names[referenced_owner][parts[1]]
        return result
    # Property/conditional references are schemas, not standalone TS type names.
    target = documents[referenced_owner]
    for part in parts: target = target[int(part)] if isinstance(target, list) else target[part]
    resolved = local_refs(target, referenced_owner)
    return {'allOf': [resolved, result]} if result else resolved
schema = {**schema, '$defs': {name: local_refs(value, 'protocol.schema.json') for name, value in schema['$defs'].items()}}
if set(schema['$defs']) & set(canonical_schema['$defs']):
    raise SystemExit('Ambiguous versioned schema definition')
schema['$defs'].update({name: local_refs(value, 'canonical-filesystem.schema.json') for name, value in canonical_schema['$defs'].items()})
# Select streaming admission for all records, including nested recovery/effects.
# Inline each profile's historical base before overlaying its definition so local
# references select the profile without recursively referring to themselves.
for name, definition in streaming_schema['$defs'].items():
    if definition.get('allOf') and definition['allOf'][0].get('$ref', '').startswith('protocol.schema.json#/$defs/'):
        base, *constraints = definition['allOf']
        if base != {'$ref': 'protocol.schema.json#/$defs/'+name}:
            raise SystemExit('Unsupported streaming profile base: '+name)
        schema['$defs'][name] = {'allOf': [schema['$defs'][name], *local_refs(constraints, 'streaming-profile.schema.json')]}
    else:
        schema['$defs'][name] = local_refs(definition, 'streaming-profile.schema.json')
for name, definition in documents['dependency-manifest.schema.json']['$defs'].items():
    schema['$defs'][names['dependency-manifest.schema.json'][name]] = local_refs(definition, 'dependency-manifest.schema.json')
schema['$defs']['JobRequest'] = {'$ref': '#/$defs/GenericJobRequest'}
def ts(s, inherited=None):
    if '$ref' in s: return s['$ref'].split('/')[-1]
    if 'const' in s: return json.dumps(s['const'])
    if 'enum' in s: return ' | '.join(json.dumps(x) for x in s['enum'])
    t=s.get('type')
    props=s.get('properties', inherited or {})
    parts=[]
    if t=='object' or 'required' in s:
        if not props and t=='object': parts.append('Record<string, '+ts(s.get('additionalProperties', {}))+'>' )
        else:
            fields=props if t=='object' else {k: props.get(k,{}) for k in s.get('required',[])}
            parts.append('{ '+ '; '.join(json.dumps(k)+('' if k in s.get('required',[]) else '?')+': '+ts(v) for k,v in fields.items())+' }')
    for k in ['oneOf', 'anyOf']:
        if k in s: parts.append('(' + ' | '.join(ts(x,props) for x in s[k]) + ')')
    if 'allOf' in s: parts.extend(ts(x,props) for x in s['allOf'])
    if 'not' in s and 'required' in s['not']:
        parts.append('{ '+ '; '.join(json.dumps(k)+'?: never' for k in s['not']['required'])+' }')
    if parts: return '('+' & '.join(parts)+')' if len(parts)>1 else parts[0]
    if t=='array': return '('+ts(s['items'])+')[]'
    return {'string':'string','integer':'number','number':'number','boolean':'boolean','null':'null'}.get(t,'unknown')
out = root / 'packages/remote-execution/src/wire.generated.ts'
text = '// Generated by scripts/protocol.py from schemas/v1 protocol, canonical, streaming and dependency schemas.\n'
text += '\n'.join('export type '+k+' = '+ts(v)+';' for k,v in schema['$defs'].items())+'\n'
text += 'export const wireDefinitions: Record<string, unknown> = '+json.dumps(schema['$defs'],indent=2)+';\n'
if '--check' in sys.argv:
    if not out.exists() or out.read_text() != text:
        raise SystemExit('Versioned wire types/schema are stale; run python3 scripts/protocol.py')
else:
    out.write_text(text)
