import assert from 'node:assert/strict';
import {canonicalBytes} from './census.mjs';
assert.equal(canonicalBytes([{path:'/owned',type:'directory',mode:448}]).toString(), 'wrong-presealed-census', 'EARLY_CENSUS_TEST_FAILURE');
