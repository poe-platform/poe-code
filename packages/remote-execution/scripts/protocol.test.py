"""In-memory schema generator regression checks; no fixture files are written."""
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch


class ProtocolGeneratorTests(unittest.TestCase):
    def test_standalone_conditional_and_historical_overlay(self):
        schemas = {
            'protocol.schema.json': {'$id': 'protocol.schema.json', '$defs': {
                'Effect': {'type': 'object', 'properties': {'bytes': {'type': 'string'}}},
            }},
            'canonical-filesystem.schema.json': {'$id': 'canonical-filesystem.schema.json', '$defs': {}},
            'dependency-manifest.schema.json': {'$id': 'dependency-manifest.schema.json', '$defs': {}},
            'streaming-profile.schema.json': {'$id': 'streaming-profile.schema.json', '$defs': {
                'Effect': {'allOf': [
                    {'$ref': 'protocol.schema.json#/$defs/Effect'},
                    {'not': {'required': ['bytes']}},
                ]},
                'GenericJobRequest': {'type': 'object', 'allOf': [
                    {'if': {'required': ['revision']}, 'then': {'required': ['binding']}},
                ]},
            }},
        }
        writes = []
        def read(path, *args, **kwargs):
            self.assertEqual(path.parent, Path(__file__).resolve().parents[1] / 'schemas/v1')
            return json.dumps(schemas[path.name])
        def write(path, value, *args, **kwargs):
            writes.append(value)
        with patch.object(Path, 'read_text', read), patch.object(Path, 'write_text', write), patch.object(Path, 'iterdir', return_value=iter(())), patch('sys.argv', ['protocol.py']):
            result = runpy.run_path(str(Path(__file__).with_name('protocol.py')))
        definitions = result['schema']['$defs']
        self.assertEqual(definitions['GenericJobRequest'], schemas['streaming-profile.schema.json']['$defs']['GenericJobRequest'])
        self.assertEqual(definitions['Effect']['allOf'][0], schemas['protocol.schema.json']['$defs']['Effect'])
        self.assertEqual(len(writes), 1)

    def test_dependency_profile_resolves_owned_names_and_nested_references(self):
        source = Path(__file__).resolve().parents[1] / 'schemas/v1'
        schemas = {path.name: path.read_text() for path in source.iterdir() if path.name.endswith('.schema.json')}
        writes = []
        with patch.object(Path, 'read_text', lambda path: schemas[path.name]), patch.object(Path, 'write_text', lambda path, value: writes.append(value)), patch.object(Path, 'iterdir', return_value=iter(())), patch('sys.argv', ['protocol.py']):
            result = runpy.run_path(str(Path(__file__).with_name('protocol.py')))
        definitions = result['schema']['$defs']
        request = definitions['DependencyJobRequest']
        self.assertEqual(request['properties']['args'], definitions['GenericJobRequest']['properties']['args'])
        self.assertEqual(request['allOf'], definitions['GenericJobRequest']['allOf'])
        self.assertEqual(definitions['Blob']['required'], ['blobId', 'size', 'digest'])
        self.assertIn('DependencyManifest', definitions)
        self.assertIn('ManifestInvocation', definitions)
        self.assertIn('export type DependencyJobRequest', writes[0])
        self.assertNotIn(' = args;', writes[0])


if __name__ == '__main__':
    unittest.main()
