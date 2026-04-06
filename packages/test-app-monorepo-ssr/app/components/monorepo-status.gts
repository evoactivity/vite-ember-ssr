import Component from '@glimmer/component';
import { tracked } from 'monorepo-lib';

/**
 * A component that imports `tracked` from the sibling workspace package
 * `monorepo-lib`, which re-exports it from `@glimmer/tracking`.
 *
 * This is the core of the pnpm monorepo SSR test: the sibling package's
 * transitive import of @glimmer/tracking must be resolved correctly
 * during the SSR build.
 *
 * See: https://github.com/evoactivity/vite-ember-ssr/issues/4
 */
export default class MonorepoStatus extends Component {
  @tracked label = 'monorepo-import-works';

  <template>
    <div data-component="monorepo-status" data-label={{this.label}}>
      <p>Import from sibling package: <strong>{{this.label}}</strong></p>
    </div>
  </template>
}
