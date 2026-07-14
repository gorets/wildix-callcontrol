declare module 'ltx' {
  export interface Element {
    name: string;
    attrs: Record<string, string | number | boolean | undefined>;
    getChild(name: string): Element | undefined;
    getChildren(name: string): Element[];
    getText(): string;
  }

  export function parse(xml: string): Element;
}
