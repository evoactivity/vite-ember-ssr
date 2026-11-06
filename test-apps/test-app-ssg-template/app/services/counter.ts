import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

/**
 * A simple counter service to test:
 * - Tracked state in SSR (initial values render correctly)
 * - Service persistence across route transitions (client-side)
 * - Service injection in components via @service
 */
export default class CounterService extends Service {
  @tracked count = 0;

  increment = () => {
    this.count++;
  };

  decrement = () => {
    this.count--;
  };

  reset = () => {
    this.count = 0;
  };

  get isPositive(): boolean {
    return this.count > 0;
  }

  get isNegative(): boolean {
    return this.count < 0;
  }

  get label(): string {
    if (this.count === 0) return 'zero';
    return this.count > 0 ? 'positive' : 'negative';
  }
}
