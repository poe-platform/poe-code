import * as own from '../dist/index.js';
import * as sdk from '@poe-code/frontmatter';
const compatible:typeof sdk=own;void compatible;
const document:sdk.ParsedFrontmatterDocument=own.parseFrontmatterDocument('---\ntitle: example\n---\nBody');void document;
