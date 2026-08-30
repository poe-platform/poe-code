import type { FileSystem, WebDavFileSystemOptions } from "virtual-bash";

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Callback = NonNullable<WebDavFileSystemOptions["compareEntry"]>;
type Comparison = NonNullable<FileSystem["compareEntry"]>;
type WrongReceiver = (this: number, ...args: Parameters<Comparison>) => ReturnType<Comparison>;

export type PublicComparisonTypeAssertions = [
  Assert<undefined extends WebDavFileSystemOptions["compareEntry"] ? true : false>,
  Assert<Equal<ThisParameterType<Callback>, FileSystem>>,
  Assert<Equal<Parameters<Callback>, Parameters<Comparison>>>,
  Assert<Equal<ReturnType<Callback>, ReturnType<Comparison>>>,
  Assert<Comparison extends Callback ? true : false>,
  Assert<Callback extends Comparison ? true : false>,
  Assert<WrongReceiver extends Callback ? false : true>
];
