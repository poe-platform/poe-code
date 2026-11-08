/** Preserve constructor prototypes and statics while supporting factory calls. */
export function callableConstructor<Constructor extends new (...args: never[]) => object>(
  constructor: Constructor
): Constructor & ((...args: ConstructorParameters<Constructor>) => InstanceType<Constructor>) {
  return new Proxy(constructor, {
    apply(target, _receiver, args) {
      return Reflect.construct(target, args);
    }
  }) as Constructor & ((...args: ConstructorParameters<Constructor>) => InstanceType<Constructor>);
}
