import { describe, it, expect, vi } from 'vitest';
import {
  compose,
  forwardCookieMiddleware,
  shoeboxMiddleware,
} from '../src/fetch-middleware.ts';

// ─── compose() ───────────────────────────────────────────────────────

describe('compose', () => {
  it('calls the terminal directly when no middlewares are configured', async () => {
    const terminal = vi.fn(async (req) => new Response('ok'));
    const fn = compose([], terminal);

    const res = await fn('https://api.example.com/x');

    expect(terminal).toHaveBeenCalledOnce();
    expect(terminal.mock.calls[0][0]).toBeInstanceOf(Request);
    expect(terminal.mock.calls[0][0].url).toBe('https://api.example.com/x');
    expect(await res.text()).toBe('ok');
  });

  it('runs middlewares in array order on the way in', async () => {
    const trace = [];
    const a = async (req, next) => {
      trace.push('a-in');
      const r = await next(req);
      trace.push('a-out');
      return r;
    };
    const b = async (req, next) => {
      trace.push('b-in');
      const r = await next(req);
      trace.push('b-out');
      return r;
    };
    const terminal = async () => {
      trace.push('terminal');
      return new Response('ok');
    };

    await compose([a, b], terminal)('https://x.test');

    expect(trace).toEqual(['a-in', 'b-in', 'terminal', 'b-out', 'a-out']);
  });
});

// ─── forwardCookieMiddleware ─────────────────────────────────────────

describe('forwardCookieMiddleware', () => {
  function runWith(cookie, request, init) {
    const captured = { request: null };
    const terminal = async (req) => {
      captured.request = req;
      return new Response('ok');
    };
    const fn = compose([forwardCookieMiddleware(() => cookie)], terminal);
    return fn(request, init).then(() => captured.request);
  }

  it('passes through unchanged when no cookie is configured', async () => {
    const req = await runWith(null, 'https://api.example.com/x');

    expect(req.headers.has('cookie')).toBe(false);
  });

  it('injects the cookie when the request host matches allowedHosts', async () => {
    const req = await runWith(
      { value: 'session=abc', allowedHosts: ['api.example.com'] },
      'https://api.example.com/x',
    );

    expect(req.headers.get('cookie')).toBe('session=abc');
  });

  it('does NOT inject the cookie when the host is not in allowedHosts', async () => {
    const req = await runWith(
      { value: 'session=abc', allowedHosts: ['api.example.com'] },
      'https://pokeapi.co/api/v2/pokemon/pikachu',
    );

    expect(req.headers.has('cookie')).toBe(false);
  });

  it('matches host with port (URL.host semantics)', async () => {
    const matched = await runWith(
      { value: 'v', allowedHosts: ['api.example.com:8080'] },
      'https://api.example.com:8080/x',
    );
    expect(matched.headers.get('cookie')).toBe('v');

    // Different port → no match
    const notMatched = await runWith(
      { value: 'v', allowedHosts: ['api.example.com:8080'] },
      'https://api.example.com/x',
    );
    expect(notMatched.headers.has('cookie')).toBe(false);
  });

  it('does NOT do suffix matching (subdomain attacker scenario)', async () => {
    // 'evil-api.example.com' must not satisfy a rule for 'example.com'
    const req = await runWith(
      { value: 'v', allowedHosts: ['example.com'] },
      'https://evil-api.example.com/x',
    );

    expect(req.headers.has('cookie')).toBe(false);
  });

  it('does not overwrite a cookie explicitly set on the request', async () => {
    const req = await runWith(
      { value: 'forwarded', allowedHosts: ['api.example.com'] },
      'https://api.example.com/x',
      { headers: { cookie: 'app-set' } },
    );

    expect(req.headers.get('cookie')).toBe('app-set');
  });

  it('forwards the cookie on non-GET methods too', async () => {
    const req = await runWith(
      { value: 'session=abc', allowedHosts: ['api.example.com'] },
      'https://api.example.com/submit',
      { method: 'POST', body: 'payload' },
    );

    expect(req.method).toBe('POST');
    expect(req.headers.get('cookie')).toBe('session=abc');
  });
});

// ─── shoeboxMiddleware ───────────────────────────────────────────────

describe('shoeboxMiddleware', () => {
  it('captures GET responses into the entries map', async () => {
    const entries = new Map();
    const terminal = async () =>
      new Response('hello', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
      });

    await compose(
      [shoeboxMiddleware(() => entries)],
      terminal,
    )('https://api.example.com/x');

    expect(entries.size).toBe(1);
    const entry = entries.get('https://api.example.com/x');
    expect(entry.body).toBe('hello');
    expect(entry.status).toBe(200);
    expect(entry.headers['content-type']).toBe('text/plain');
  });

  it('does NOT serialize Set-Cookie into the entry (auth-token leak)', async () => {
    const entries = new Map();
    const terminal = async () => {
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.append('set-cookie', 'X-Auth-Token=secret; Path=/; HttpOnly');
      return new Response('{"ok":true}', { status: 200, statusText: 'OK', headers });
    };

    await compose(
      [shoeboxMiddleware(() => entries)],
      terminal,
    )('https://api.example.com/account');

    const entry = entries.get('https://api.example.com/account');
    // body + non-sensitive headers still captured for replay
    expect(entry.body).toBe('{"ok":true}');
    expect(entry.headers['content-type']).toBe('application/json');
    // Set-Cookie must never reach the serialized shoebox / rendered HTML
    expect(entry.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('X-Auth-Token');
  });

  it('does NOT capture when entries map is null', async () => {
    const terminal = async () => new Response('hello');
    const result = await compose(
      [shoeboxMiddleware(() => null)],
      terminal,
    )('https://api.example.com/x');

    expect(await result.text()).toBe('hello');
  });

  it('does NOT capture non-GET responses', async () => {
    const entries = new Map();
    const terminal = async () => new Response('ok');

    await compose([shoeboxMiddleware(() => entries)], terminal)(
      'https://api.example.com/x',
      { method: 'POST', body: 'data' },
    );

    expect(entries.size).toBe(0);
  });
});

// ─── Pipeline order ──────────────────────────────────────────────────

describe('pipeline ordering', () => {
  it('shoebox captures the request as modified by forwardCookie', async () => {
    // forwardCookie runs first, so the shoebox sees the request with the
    // cookie attached. This matches what the real fetch will see.
    const entries = new Map();
    let observedCookieInTerminal;
    const terminal = async (req) => {
      observedCookieInTerminal = req.headers.get('cookie');
      return new Response('body');
    };
    const fn = compose(
      [
        forwardCookieMiddleware(() => ({
          value: 'forwarded',
          allowedHosts: ['api.example.com'],
        })),
        shoeboxMiddleware(() => entries),
      ],
      terminal,
    );

    await fn('https://api.example.com/x');

    expect(observedCookieInTerminal).toBe('forwarded');
    expect(entries.size).toBe(1);
  });
});
