# Changelog

## Release (2026-07-19)

* vite-ember-ssr 0.4.0 (minor)

#### :rocket: Enhancement
* `vite-ember-ssr`
  * [#17](https://github.com/evoactivity/vite-ember-ssr/pull/17) feat: warn loudly when the SSR bundle exports no settled function ([@st-h](https://github.com/st-h))

#### :bug: Bug Fix
* `vite-ember-ssr`
  * [#20](https://github.com/evoactivity/vite-ember-ssr/pull/20) feat: add getComputedStyle to global browser constants ([@evoactivity](https://github.com/evoactivity))
  * [#13](https://github.com/evoactivity/vite-ember-ssr/pull/13) fix: destroy the per-visit ApplicationInstance even when render throws ([@st-h](https://github.com/st-h))
  * [#15](https://github.com/evoactivity/vite-ember-ssr/pull/15) fix: bind shoebox capture to the render that started the fetch ([@st-h](https://github.com/st-h))

#### Committers: 2
- Liam ([@evoactivity](https://github.com/evoactivity))
- Steve ([@st-h](https://github.com/st-h))

## Release (2026-05-29)

* vite-ember-ssr 0.3.0 (minor)

#### :rocket: Enhancement
* `vite-ember-ssr`
  * [#7](https://github.com/evoactivity/vite-ember-ssr/pull/7) feat: forward request headers to fetch calls during SSR ([@st-h](https://github.com/st-h))

#### Committers: 1
- Steve ([@st-h](https://github.com/st-h))

## Release (2026-05-27)

* vite-ember-ssr 0.2.0 (minor)

#### :rocket: Enhancement
* `vite-ember-ssr`
  * [#11](https://github.com/evoactivity/vite-ember-ssr/pull/11) Update peer dependency for vite to include version 8 ([@NullVoxPopuli](https://github.com/NullVoxPopuli))

#### Committers: 1
- [@NullVoxPopuli](https://github.com/NullVoxPopuli)

## Release (2026-05-03)

* vite-ember-ssr 0.1.0 (minor)

#### :rocket: Enhancement
* `vite-ember-ssr`
  * [#6](https://github.com/evoactivity/vite-ember-ssr/pull/6) feat: extract and apply body element attributes from SSR rendering ([@st-h](https://github.com/st-h))
  * [#9](https://github.com/evoactivity/vite-ember-ssr/pull/9) Use settled if exported from app-ssr.ts ([@evoactivity](https://github.com/evoactivity))
  * [#8](https://github.com/evoactivity/vite-ember-ssr/pull/8) Rehydrate Only ([@evoactivity](https://github.com/evoactivity))

#### Committers: 2
- Liam ([@evoactivity](https://github.com/evoactivity))
- Steve ([@st-h](https://github.com/st-h))
