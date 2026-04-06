/**
 * A sibling workspace library that depends on ember-source and imports
 * @glimmer/tracking (a virtual package provided by ember-source).
 *
 * This simulates the real-world pattern where a workspace package
 * (or third-party addon like `tracked-built-ins`) imports Ember/Glimmer
 * APIs. In a pnpm workspace, these transitive imports can fail at
 * runtime during SSG child builds because pnpm's strict node_modules
 * layout doesn't make @glimmer/tracking accessible from the sibling
 * package's location — it's only resolvable through ember-source's
 * package exports, not as a standalone npm package.
 *
 * See: https://github.com/evoactivity/vite-ember-ssr/issues/4
 */
export { tracked } from '@glimmer/tracking';

/**
 * A simple utility that uses @glimmer/tracking's `tracked` decorator
 * to create a reactive value holder.
 */
export class TrackedMessage {
  /** @tracked */
  message;

  constructor(message) {
    this.message = message;
  }
}
