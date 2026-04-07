import { Worker } from 'node:worker_threads';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const bundleURL =
  'file://' +
  resolve(repoRoot, 'packages/test-app-combined/dist/server/app-ssr.mjs');
const REUSE = resolve(__dirname, 'reuse-worker.mjs');
const FRESH = resolve(repoRoot, 'packages/vite-ember-ssr/dist/ssr-worker.js');

function makeReuse() {
  const w = new Worker(REUSE, { workerData: { ssrBundlePath: bundleURL } });
  let id = 0;
  const p = new Map();
  w.on('message', (m) => {
    p.get(m.id)?.(m);
    p.delete(m.id);
  });
  w.on('error', (e) => console.error('worker error', e.message));
  return {
    render(url) {
      return new Promise((r) => {
        const i = id++;
        p.set(i, r);
        w.postMessage({ url, id: i });
      });
    },
    terminate() {
      w.terminate();
    },
  };
}

function renderFresh(url) {
  return new Promise((res, rej) => {
    const w = new Worker(FRESH, {
      workerData: {
        ssrBundlePath: bundleURL,
        url,
        shoebox: false,
        rehydrate: false,
        cssManifest: null,
      },
    });
    w.once('message', (m) => {
      w.terminate();
      res(m);
    });
    w.once('error', (e) => {
      w.terminate();
      rej(e);
    });
  });
}

function strip(body) {
  return body
    .replace('<script type="x/boundary" id="ssr-body-start"></script>', '')
    .replace('<script type="x/boundary" id="ssr-body-end"></script>', '');
}

function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return {
        pos: i,
        reused: JSON.stringify(a.slice(Math.max(0, i - 40), i + 80)),
        fresh: JSON.stringify(b.slice(Math.max(0, i - 40), i + 80)),
      };
    }
  }
  return null;
}

const routes = ['/', '/about', '/contact', '/pokemon-fetch'];
const rw = makeReuse();

// Render / first (just like the isolation test does 5x), then check /about
await rw.render('/');
await rw.render('/');
await rw.render('/');
await rw.render('/');
await rw.render('/');

for (const url of routes) {
  const r = await rw.render(url);
  const f = await renderFresh(url);
  const freshBody = strip(f.body);
  const diff = firstDiff(r.body, freshBody);
  if (diff) {
    console.log('\n' + url, '— MISMATCH at char', diff.pos);
    console.log('reused:', diff.reused);
    console.log('fresh: ', diff.fresh);
  } else {
    console.log(url, '— identical');
  }
}

rw.terminate();
