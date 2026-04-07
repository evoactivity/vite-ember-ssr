/**
 * Tests whether re-using a worker (calling createSsrApp + app.visit
 * repeatedly in the same V8 isolate) produces correct, identical output
 * and has no cross-route contamination.
 */
import { Worker } from 'node:worker_threads';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const bundlePath = resolve(
  repoRoot,
  'packages/test-app-combined/dist/server/app-ssr.mjs',
);
const bundleURL = `file://${bundlePath}`;

const REUSE_WORKER_PATH = resolve(__dirname, 'reuse-worker.mjs');
const FRESH_WORKER_PATH = resolve(
  repoRoot,
  'packages/vite-ember-ssr/dist/ssr-worker.js',
);

function makeReuseWorker() {
  const w = new Worker(REUSE_WORKER_PATH, {
    workerData: { ssrBundlePath: bundleURL },
  });
  let nextId = 0;
  const pending = new Map();
  w.on('message', (msg) => {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  w.on('error', (e) => {
    console.error('Reuse worker error:', e.message);
  });
  return {
    render(url) {
      return new Promise((res) => {
        const id = nextId++;
        pending.set(id, res);
        w.postMessage({ url, id });
      });
    },
    terminate() {
      w.terminate();
    },
  };
}

function renderFresh(url) {
  return new Promise((res, rej) => {
    const w = new Worker(FRESH_WORKER_PATH, {
      workerData: {
        ssrBundlePath: bundleURL,
        url,
        shoebox: false,
        rehydrate: false,
        cssManifest: null,
      },
    });
    w.once('message', (msg) => {
      w.terminate();
      res(msg);
    });
    w.once('error', (e) => {
      w.terminate();
      rej(e);
    });
  });
}

const routes = ['/', '/about', '/contact', '/pokemon-fetch'];
const worker = makeReuseWorker();

// Pre-render all routes once with fresh workers for the ground truth
console.log('Fetching ground truth via fresh workers...');
const groundTruth = {};
for (const url of routes) {
  groundTruth[url] = (await renderFresh(url)).body;
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
    failed++;
  }
}

// ── Test 1: Same route 5x — output must be identical every time ───────
console.log('\nTest 1: same route, 5x on same worker (output must be stable)');
for (const url of routes) {
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await worker.render(url));
  check(
    `${url} — no errors`,
    results.every((r) => r.ok),
    results
      .filter((r) => !r.ok)
      .map((r) => r.error)
      .join(', '),
  );
  check(
    `${url} — identical output across 5 renders`,
    results.every((r) => r.body === results[0].body),
    `lengths: ${results.map((r) => r.body.length).join(', ')}`,
  );
}

// ── Test 2: Reused worker matches fresh worker ────────────────────────
console.log(
  '\nTest 2: reused worker output matches fresh worker (ground truth)',
);
for (const url of routes) {
  const reused = await worker.render(url);
  check(
    `${url} — matches fresh worker`,
    reused.ok && reused.body === groundTruth[url],
    reused.ok
      ? `reused=${reused.body.length} fresh=${groundTruth[url].length}`
      : reused.error,
  );
}

// ── Test 3: Cross-route contamination ─────────────────────────────────
console.log('\nTest 3: cross-route contamination (no foreign route markers)');
const markers = {
  '/': 'data-route="index"',
  '/about': 'data-route="about"',
  '/contact': 'data-route="contact"',
  '/pokemon-fetch': 'data-route="pokemon-fetch"',
};
// Render routes in reverse to maximise chance of contamination
for (const url of [...routes].reverse()) {
  const r = await worker.render(url);
  const foreign = Object.entries(markers)
    .filter(([u]) => u !== url)
    .filter(([, m]) => r.body.includes(m))
    .map(([u]) => u);
  check(
    `${url} — no foreign markers`,
    foreign.length === 0,
    `found: ${foreign.join(', ')}`,
  );
  check(`${url} — own marker present`, r.body.includes(markers[url]));
}

// ── Test 4: Interleaved renders (A B A B) ─────────────────────────────
console.log('\nTest 4: interleaved renders — A B A B pattern');
const order = ['/', '/about', '/', '/about', '/contact', '/', '/contact'];
for (const url of order) {
  const r = await worker.render(url);
  check(
    `${url} — correct after interleave (render #${r.renderCount})`,
    r.ok && r.body === groundTruth[url],
    r.ok ? `len=${r.body.length} expected=${groundTruth[url].length}` : r.error,
  );
}

worker.terminate();

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
