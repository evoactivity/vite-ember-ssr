/**
 * Benchmark for vite-ember-ssr rendering performance.
 *
 * Measures:
 *   - createEmberApp() startup time (pool creation + first warm-up render)
 *   - Per-render latency (p50, p95, p99, min, max) for a steady-state pool
 *   - Throughput: renders/sec at varying concurrency levels
 *
 * Uses test-app (eager bundle) and test-app-lazy-ssr (lazy/code-split bundle).
 *
 * Usage (from repo root):
 *   node benchmark/render-perf.mjs
 *   node benchmark/render-perf.mjs --app lazy   # lazy-ssr bundle only
 *   node benchmark/render-perf.mjs --app eager  # eager bundle only
 *
 * Results are written to benchmark/results/<timestamp>.txt
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmberApp } from '../packages/vite-ember-ssr/dist/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────────

const WARMUP_RENDERS = 5;
const SAMPLE_RENDERS = 50;
const CONCURRENCY_LEVELS = [1, 2, 4, 8];
const ROUTES = ['/', '/about', '/contact'];

const APPS = {
  eager: {
    label: 'test-app (eager bundle)',
    dist: resolve(repoRoot, 'packages/test-app/dist'),
    bundle: 'server/app-ssr.mjs',
    template: 'client/index.html',
  },
  lazy: {
    label: 'test-app-lazy-ssr (lazy/code-split bundle)',
    dist: resolve(repoRoot, 'packages/test-app-lazy-ssr/dist'),
    bundle: 'server/app-ssr.mjs',
    template: 'client/index.html',
  },
};

const argApp = process.argv.includes('--app')
  ? process.argv[process.argv.indexOf('--app') + 1]
  : null;
const appsToRun = argApp ? { [argApp]: APPS[argApp] } : APPS;

// ─── Stats helpers ───────────────────────────────────────────────────

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    count: sorted.length,
  };
}

function fmt(ms) {
  return ms.toFixed(1).padStart(7) + ' ms';
}

function ruler(width = 72) {
  return '─'.repeat(width);
}

// ─── Benchmark helpers ───────────────────────────────────────────────

async function timeRender(app, url) {
  const t0 = performance.now();
  await app.renderRoute(url);
  return performance.now() - t0;
}

async function runConcurrent(app, url, concurrency, count) {
  const samples = [];
  let remaining = count;
  async function worker() {
    while (remaining-- > 0) {
      samples.push(await timeRender(app, url));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return samples;
}

// ─── Main ─────────────────────────────────────────────────────────────

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19);

const lines = [];
function out(line = '') {
  console.log(line);
  lines.push(line);
}

out(`vite-ember-ssr render-perf benchmark`);
out(`date:  ${new Date().toISOString()}`);
out(`node:  ${process.version}`);

for (const [key, cfg] of Object.entries(appsToRun)) {
  const bundlePath = resolve(cfg.dist, cfg.bundle);

  try {
    await readFile(resolve(cfg.dist, cfg.template), 'utf-8');
  } catch {
    out(
      `\n  [${key}] dist not found — run pnpm test (or pnpm build in the test app) first.`,
    );
    continue;
  }

  out('');
  out(`${'═'.repeat(72)}`);
  out(`  ${cfg.label}`);
  out(`${'═'.repeat(72)}`);

  // ── 1. createEmberApp startup time ──────────────────────────────────
  out('');
  out('  1. Pool startup (createEmberApp)');
  out(`  ${ruler()}`);

  const t0 = performance.now();
  const app = await createEmberApp(bundlePath);
  const startupMs = performance.now() - t0;
  out(`     createEmberApp():  ${fmt(startupMs)}`);

  // ── 2. First render (cold — bundle imported inside worker) ───────────
  out('');
  out('  2. First render latency (cold — bundle imported in worker)');
  out(`  ${ruler()}`);

  for (const route of ROUTES) {
    const ms = await timeRender(app, route);
    out(`     ${route.padEnd(30)} ${fmt(ms)}`);
  }

  // ── 3. Warm render latency (steady state, concurrency=1) ─────────────
  out('');
  out(
    `  3. Warm render latency (steady state, concurrency=1, n=${SAMPLE_RENDERS})`,
  );
  out(`  ${ruler()}`);
  out(
    `     ${'route'.padEnd(20)} ${'min'.padStart(9)} ${'p50'.padStart(9)} ${'p95'.padStart(9)} ${'p99'.padStart(9)} ${'max'.padStart(9)} ${'mean'.padStart(9)}`,
  );
  out(`  ${ruler()}`);

  for (const route of ROUTES) {
    for (let i = 0; i < WARMUP_RENDERS; i++) await timeRender(app, route);
    const samples = [];
    for (let i = 0; i < SAMPLE_RENDERS; i++)
      samples.push(await timeRender(app, route));
    const s = stats(samples);
    out(
      `     ${route.padEnd(20)} ${fmt(s.min)} ${fmt(s.p50)} ${fmt(s.p95)} ${fmt(s.p99)} ${fmt(s.max)} ${fmt(s.mean)}`,
    );
  }

  // ── 4. Throughput at varying concurrency ─────────────────────────────
  const route = '/';
  const throughputRenders = SAMPLE_RENDERS * 4;
  out('');
  out(
    `  4. Throughput — route "${route}", ${throughputRenders} renders per concurrency level`,
  );
  out(`  ${ruler()}`);
  out(
    `     ${'concurrency'.padEnd(15)} ${'renders/sec'.padStart(14)} ${'p50 latency'.padStart(14)} ${'p99 latency'.padStart(14)}`,
  );
  out(`  ${ruler()}`);

  for (const c of CONCURRENCY_LEVELS) {
    await runConcurrent(app, route, Math.min(c, 2), WARMUP_RENDERS);
    const t1 = performance.now();
    const samples = await runConcurrent(app, route, c, throughputRenders);
    const elapsed = (performance.now() - t1) / 1000;
    const rps = throughputRenders / elapsed;
    const s = stats(samples);
    out(
      `     ${String(c).padEnd(15)} ${rps.toFixed(1).padStart(14)} rps ${fmt(s.p50)} ${fmt(s.p99)}`,
    );
  }

  await app.destroy();
}

out('');

// ─── Write results file ───────────────────────────────────────────────

const resultsDir = resolve(__dirname, 'results');
await mkdir(resultsDir, { recursive: true });
const outPath = resolve(resultsDir, `${timestamp}.txt`);
await writeFile(outPath, lines.join('\n') + '\n', 'utf-8');
console.log(`\nResults written → benchmark/results/${timestamp}.txt`);
