import { afterEach, describe, it, expect } from 'vitest';
import { setStatusCode } from '../src/client.ts';
import { resetStatusCode, statusCodeFor } from '../src/status-code.ts';

describe('setStatusCode', () => {
  afterEach(() => resetStatusCode());

  it('sets the code of the render', () => {
    setStatusCode(410);

    expect(statusCodeFor(undefined)).toBe(410);
  });

  it('defaults to 200', () => {
    expect(statusCodeFor(undefined)).toBe(200);
  });

  it('answers 500 for a render error, even after setStatusCode()', () => {
    setStatusCode(404);

    expect(statusCodeFor(new Error('boom'))).toBe(500);
  });

  it('throws for a value that is not an HTTP status code', () => {
    for (const code of [0, 99, 600, 404.5, Number.NaN]) {
      expect(() => setStatusCode(code)).toThrow(RangeError);
    }
  });
});
