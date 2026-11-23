import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { serializeControlState } from '../src/control-state.ts';

function render(html, write) {
  const win = new Window();
  serializeControlState(win);
  win.document.body.innerHTML = html;
  write(win.document);
  return win.document.body.innerHTML;
}

describe('serializeControlState', () => {
  it("writes a text field's value as its attribute", () => {
    expect(
      render('<input name="name">', (document) => {
        document.querySelector('input').value = 'Ada';
      }),
    ).toBe('<input name="name" value="Ada">');
  });

  it("writes a box's checked state, and removes it once cleared", () => {
    expect(
      render(
        '<input type="checkbox"><input type="radio" checked>',
        (document) => {
          const [box, radio] = document.querySelectorAll('input');
          box.checked = true;
          radio.checked = false;
        },
      ),
    ).toBe('<input type="checkbox" checked=""><input type="radio">');
  });

  it("writes a textarea's value as its text", () => {
    expect(
      render('<textarea></textarea>', (document) => {
        document.querySelector('textarea').value = 'Buy milk';
      }),
    ).toBe('<textarea>Buy milk</textarea>');
  });

  it('marks only the option that was selected', () => {
    expect(
      render(
        '<select><option value="s">S</option><option value="m">M</option></select>',
        (document) => {
          document.querySelectorAll('option')[1].selected = true;
        },
      ),
    ).toBe(
      '<select><option value="s">S</option><option value="m" selected="">M</option></select>',
    );
  });

  it('leaves a control nothing wrote to as the markup wrote it', () => {
    const html =
      '<select><option value="s">S</option></select><input value="x">';
    expect(render(html, () => {})).toBe(html);
  });
});
