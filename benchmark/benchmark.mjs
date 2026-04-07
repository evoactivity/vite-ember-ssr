/**
 * vite-ember-ssr render throughput benchmark
 *
 * Usage:
 *   node benchmark/benchmark.mjs
 *   node benchmark/benchmark.mjs --bundle /path/to/app-ssr.mjs --routes / /about /contact
 *   node benchmark/benchmark.mjs --concurrency 4 --iterations 3
 *
 * Results are written to benchmark/results/<timestamp>.txt
 *
 * Experiments measured:
 *   A) baseline      — current arch: fresh Worker per render, sequential
 *   B) parallel      — fresh Worker per render, parallel with concurrency limit
 *   C) worker-reuse  — pool of N long-lived Workers, each reuses app.visit()
 *                      between renders (no isolation, fastest possible)
 *
 * The benchmark intentionally avoids using the vite-plugin layer —
 * it calls renderEmberApp() directly so we can swap render strategies
 * without rebuilding anything.
 */

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ── CLI argument parsing ────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, defaultValue) {
  const i = args.indexOf(flag);
  if (i === -1) return defaultValue;
  return args[i + 1];
}

function getArgList(flag, defaultValue) {
  const i = args.indexOf(flag);
  if (i === -1) return defaultValue;
  const values = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) {
    values.push(args[j]);
  }
  return values.length ? values : defaultValue;
}

const bundlePath = getArg(
  '--bundle',
  resolve(repoRoot, 'packages/test-app-combined/dist/server/app-ssr.mjs'),
);

const routes = getArgList('--routes', [
  '/',
  '/about',
  '/contact',
  '/pokemon-fetch',
]);
const concurrency = parseInt(getArg('--concurrency', '8'), 10);
const iterations = parseInt(getArg('--iterations', '3'), 10);

// ── Helpers ─────────────────────────────────────────────────────────

const WORKER_PATH = resolve(
  repoRoot,
  'packages/vite-ember-ssr/dist/ssr-worker.js',
);

/** Render a single route in a fresh Worker (current architecture). */
function renderFresh(url) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_PATH, {
      workerData: {
        ssrBundlePath: bundlePath.startsWith('file://')
          ? bundlePath
          : `file://${bundlePath}`,
        url,
        shoebox: false,
        rehydrate: false,
        cssManifest: null,
      },
    });
    w.once('message', (msg) => {
      w.terminate();
      if (msg.fatalError) reject(new Error(msg.fatalError));
      else resolve(msg);
    });
    w.once('error', (e) => {
      w.terminate();
      reject(e);
    });
    w.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited ${code}`));
    });
  });
}

/** Run an async task with max N in flight at once. */
async function pool(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return results;
}

/** Measure wall time of fn(), returns { ms, result }. */
async function timed(fn) {
  const start = performance.now();
  const result = await fn();
  return { ms: performance.now() - start, result };
}

// ── Experiments ──────────────────────────────────────────────────────

/**
 * A: Baseline — sequential fresh Workers, one per render.
 * This is exactly what the SSG plugin does today.
 */
async function expBaseline(routes) {
  for (const url of routes) {
    await renderFresh(url);
  }
}

/**
 * B: Parallel — fresh Workers, up to `concurrency` in flight at once.
 * Same isolation guarantee as baseline, but overlaps Worker startup
 * and bundle import time with active renders.
 */
async function expParallel(routes, concurrency) {
  await pool(routes, concurrency, renderFresh);
}

/**
 * C: Worker reuse — a pool of N long-lived Workers that each import
 * the bundle once and then accept multiple render requests over a
 * message channel.
 *
 * Each Worker runs a mini message loop: receive {url} → render → reply.
 * No isolation between renders on the same Worker — Ember state
 * (router, services, etc.) from render N bleeds into render N+1.
 * This is the theoretical maximum throughput.
 */

const REUSE_WORKER_SCRIPT = /* js */ `
import { workerData, parentPort } from 'node:worker_threads';
import { Window } from 'happy-dom';
import { pathToFileURL } from 'node:url';

const { ssrBundlePath } = workerData;

const BROWSER_GLOBALS = [
  'window','document','navigator','location','history',
  'HTMLElement','Element','Node','Event','CustomEvent',
  'MutationObserver','requestAnimationFrame','cancelAnimationFrame',
  'self','localStorage','sessionStorage',
  'InputEvent','KeyboardEvent','MouseEvent','FocusEvent',
  'PointerEvent','IntersectionObserver','ResizeObserver','CSSStyleSheet',
];

// Import bundle once
const ssrModule = await import(ssrBundlePath);

// Handle each render request
parentPort.on('message', async ({ url, id }) => {
  const win = new Window({
    url: 'http://localhost' + url,
    width: 1024, height: 768,
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      navigator: { userAgent: 'vite-ember-ssr-bench' },
    },
  });

  for (const name of BROWSER_GLOBALS) {
    const value = win[name];
    try {
      Object.defineProperty(globalThis, name, {
        value, writable: true, configurable: true, enumerable: true,
      });
    } catch {}
  }

  try {
    const app = await ssrModule.createSsrApp();
    const instance = await app.visit(url, {
      isBrowser: false,
      document: win.document,
      rootElement: win.document.body,
      shouldRender: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const head = win.document.head?.innerHTML ?? '';
    const body = win.document.body?.innerHTML ?? '';

    parentPort.postMessage({ id, head, body, statusCode: 200 });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message, statusCode: 500 });
  }
});
`;

function makeReuseWorker() {
  const bundleURL = bundlePath.startsWith('file://')
    ? bundlePath
    : `file://${bundlePath}`;
  const w = new Worker(REUSE_WORKER_SCRIPT, {
    eval: true,
    workerData: { ssrBundlePath: bundleURL },
  });
  let nextId = 0;
  const pending = new Map();
  w.on('message', ({ id, ...rest }) => {
    pending.get(id)?.(rest);
    pending.delete(id);
  });
  w.on('error', (e) => {
    for (const [, resolve] of pending)
      resolve({ error: e.message, statusCode: 500 });
    pending.clear();
  });
  return {
    render(url) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        w.postMessage({ url, id });
      });
    },
    terminate() {
      return w.terminate();
    },
  };
}

async function expWorkerReuse(routes, poolSize) {
  const workers = Array.from({ length: poolSize }, makeReuseWorker);
  // Round-robin assignment
  await pool(routes, routes.length, async (url, i) => {
    return workers[i % poolSize].render(url);
  });
  await Promise.all(workers.map((w) => w.terminate()));
}

// ── Runner ────────────────────────────────────────────────────────────

async function runExperiment(name, fn) {
  // Warm-up run (not measured)
  await fn();

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const { ms } = await timed(fn);
    times.push(ms);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { name, avg, min, max, times };
}

// ── Main ─────────────────────────────────────────────────────────────

console.log('\nvite-ember-ssr benchmark');
console.log('========================');
console.log(`bundle:       ${bundlePath}`);
console.log(`routes:       ${routes.join(', ')}`);
console.log(`concurrency:  ${concurrency}`);
console.log(`iterations:   ${iterations} (+ 1 warm-up)`);
console.log('');

const results = [];

// A: Baseline (sequential fresh workers)
process.stdout.write('A baseline (sequential fresh workers)... ');
results.push(
  await runExperiment(`A: baseline — sequential fresh Worker per render`, () =>
    expBaseline(routes),
  ),
);
console.log(`avg ${results.at(-1).avg.toFixed(0)}ms`);

// B: Parallel fresh workers
process.stdout.write(
  `B parallel (fresh workers, concurrency=${concurrency})... `,
);
results.push(
  await runExperiment(
    `B: parallel — fresh Workers, concurrency=${concurrency}`,
    () => expParallel(routes, concurrency),
  ),
);
console.log(`avg ${results.at(-1).avg.toFixed(0)}ms`);

// C: Worker reuse with pool sizes
for (const poolSize of [1, 2, 4]) {
  process.stdout.write(`C worker-reuse (pool=${poolSize})... `);
  results.push(
    await runExperiment(`C: worker-reuse pool=${poolSize} (no isolation)`, () =>
      expWorkerReuse(routes, poolSize),
    ),
  );
  console.log(`avg ${results.at(-1).avg.toFixed(0)}ms`);
}

// ── Output ────────────────────────────────────────────────────────────

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19);

const outDir = join(__dirname, 'results');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${timestamp}.txt`);

const lines = [
  'vite-ember-ssr benchmark results',
  '=================================',
  `date:         ${new Date().toISOString()}`,
  `node:         ${process.version}`,
  `bundle:       ${bundlePath}`,
  `routes (${routes.length}):  ${routes.join(', ')}`,
  `concurrency:  ${concurrency}`,
  `iterations:   ${iterations} (+ 1 warm-up)`,
  '',
  'Results (wall time for all routes):',
  '',
];

const nameWidth = Math.max(...results.map((r) => r.name.length)) + 2;

for (const r of results) {
  const label = r.name.padEnd(nameWidth);
  const runs = r.times.map((t) => `${t.toFixed(0)}ms`).join('  ');
  lines.push(
    `  ${label}  avg=${r.avg.toFixed(0)}ms  min=${r.min.toFixed(0)}ms  max=${r.max.toFixed(0)}ms   [${runs}]`,
  );
}

lines.push('');
lines.push('Per-route averages (avg total / route count):');
for (const r of results) {
  const perRoute = (r.avg / routes.length).toFixed(0);
  lines.push(`  ${r.name.padEnd(nameWidth)}  ${perRoute}ms/route`);
}
lines.push('');

const output = lines.join('\n');
console.log('\n' + output);
writeFileSync(outPath, output, 'utf-8');
console.log(`Results written to ${outPath}`);
