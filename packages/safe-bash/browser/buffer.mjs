// Third-party browser dependencies receive a module-local adapter, never a
// host global. Safe Bash's own byte operations use Web APIs.
export { Buffer } from "buffer";
