import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import type CounterService from '../services/counter.ts';

/**
 * Interactive counter component.
 *
 * Tests:
 * - Service injection with @service
 * - Click event handlers ({{on "click" ...}})
 * - Reactive tracked state rendering
 * - Computed getters derived from service state
 * - data-* attributes for test assertions
 */
export default class CounterDisplay extends Component {
  @service declare counter: CounterService;

  <template>
    <div class="counter-display" data-component="counter-display">
      <h2>Counter</h2>
      <p data-count={{this.counter.count}} data-label={{this.counter.label}}>
        Count: <span class="count-value">{{this.counter.count}}</span>
      </p>
      <div class="counter-actions">
        <button
          type="button"
          data-action="decrement"
          {{on "click" this.counter.decrement}}
        >
          -
        </button>
        <button
          type="button"
          data-action="increment"
          {{on "click" this.counter.increment}}
        >
          +
        </button>
        <button
          type="button"
          data-action="reset"
          {{on "click" this.counter.reset}}
        >
          Reset
        </button>
      </div>
      {{#if this.counter.isPositive}}
        <p class="counter-status" data-status="positive">The count is positive.</p>
      {{else if this.counter.isNegative}}
        <p class="counter-status" data-status="negative">The count is negative.</p>
      {{else}}
        <p class="counter-status" data-status="zero">The count is zero.</p>
      {{/if}}
    </div>
  </template>
}
