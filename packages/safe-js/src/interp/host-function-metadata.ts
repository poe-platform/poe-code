// Native metadata is transport overhead only while its descriptor is unchanged.
// This provenance is never supplied by serialized guest data.
export const hostFunctionMetadata = new WeakMap<object, ReadonlyMap<string, PropertyDescriptor>>();
