import type { Window } from 'happy-dom';

type Setter = (this: Element, value: unknown) => void;

/**
 * Makes a form control's state part of the HTML a render serializes.
 *
 * Glimmer writes a control's `value`, `checked` and `selected` as properties, which is right in
 * a browser: the property is the live state. Serialization writes only attributes, so a
 * server-rendered `<input value={{this.name}}>` would arrive empty. On this window, each write of
 * one of those properties also writes its attribute, and a `<textarea>`'s value its text, as a
 * server render that writes markup does.
 */
export function serializeControlState(win: Window): void {
  const reflect = (
    owner: { prototype: object } | undefined,
    property: string,
    write: Setter,
  ): void => {
    if (!owner) return;
    const descriptor = findDescriptor(owner.prototype, property);
    const set = descriptor?.set;
    if (!descriptor || !set) return;
    Object.defineProperty(owner.prototype, property, {
      ...descriptor,
      set(this: Element, value: unknown) {
        set.call(this, value);
        write.call(this, value);
      },
    });
  };

  const source = win as unknown as Record<
    string,
    { prototype: object } | undefined
  >;

  reflect(source['HTMLInputElement'], 'value', function (value) {
    this.setAttribute('value', value == null ? '' : String(value));
  });
  reflect(source['HTMLInputElement'], 'checked', function (value) {
    this.toggleAttribute('checked', Boolean(value));
  });
  reflect(source['HTMLTextAreaElement'], 'value', function (value) {
    this.textContent = value == null ? '' : String(value);
  });
  reflect(source['HTMLOptionElement'], 'selected', function (value) {
    this.toggleAttribute('selected', Boolean(value));
  });
}

/** The descriptor of a property on an object or the first of its prototypes that has it. */
function findDescriptor(
  object: object | null,
  property: string,
): PropertyDescriptor | undefined {
  for (
    let each = object;
    each;
    each = Object.getPrototypeOf(each) as object | null
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(each, property);
    if (descriptor) return descriptor;
  }
  return undefined;
}
