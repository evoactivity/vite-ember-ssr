import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { waitForPromise } from '@ember/test-waiters';
import type LazyChart from './lazy-chart.gts';

/**
 * Loads LazyChart with `import()` when it renders, then renders it.
 *
 * `waitForPromise` registers the import with `@ember/test-waiters`,
 * so the SSR renderer's `settled()` waits for it before reading the DOM.
 */
export default class LazyLoader extends Component {
  @tracked Chart: typeof LazyChart | undefined;

  constructor(owner: unknown, args: object) {
    super(owner, args);

    void waitForPromise(import('./lazy-chart.gts')).then((module) => {
      this.Chart = module.default;
    });
  }

  <template>
    {{#if this.Chart}}
      <this.Chart />
    {{/if}}
  </template>
}
