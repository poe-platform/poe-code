import *as own from'../dist/index.js';import *as sdk from'@poe-code/process-runner';type Subset=Pick<typeof sdk,keyof typeof own>;const original:Subset=own;const native:typeof own=sdk;void[original,native];
import *as nativeTesting from'@poe-code/process-runner-rust/testing';import *as originalTesting from'@poe-code/process-runner/testing';const forwardTesting:typeof originalTesting=nativeTesting;const reverseTesting:typeof nativeTesting=originalTesting;
import *as nativeContext from'@poe-code/process-runner-rust/docker/build-context';import *as originalContext from'@poe-code/process-runner/docker/build-context';const forwardContext:typeof originalContext=nativeContext;const reverseContext:typeof nativeContext=originalContext;void[forwardTesting,reverseTesting,forwardContext,reverseContext];

const allForward:typeof sdk=own;const allReverse:typeof own=sdk;void[allForward,allReverse];
