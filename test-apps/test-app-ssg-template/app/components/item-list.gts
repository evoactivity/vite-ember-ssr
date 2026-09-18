import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

interface Item {
  id: number;
  name: string;
  category: string;
}

/**
 * Component with local tracked state and dynamic data.
 *
 * Tests:
 * - {{#each}} iteration with key
 * - Computed getters (filtering, counting)
 * - Conditional rendering ({{#if}}, {{else}})
 * - Local @tracked state (filter selection)
 * - data-* attributes for test assertions
 */
export default class ItemList extends Component {
  @tracked selectedCategory = 'all';

  items: Item[] = [
    { id: 1, name: 'Vite', category: 'tooling' },
    { id: 2, name: 'Ember', category: 'framework' },
    { id: 3, name: 'HappyDOM', category: 'tooling' },
    { id: 4, name: 'Glimmer', category: 'framework' },
    { id: 5, name: 'TypeScript', category: 'language' },
  ];

  get categories(): string[] {
    const cats = [...new Set(this.items.map((i) => i.category))];
    return ['all', ...cats.sort()];
  }

  get filteredItems(): Item[] {
    if (this.selectedCategory === 'all') {
      return this.items;
    }
    return this.items.filter((i) => i.category === this.selectedCategory);
  }

  get filteredCount(): number {
    return this.filteredItems.length;
  }

  selectCategory = (category: string) => {
    this.selectedCategory = category;
  };

  <template>
    <div class="item-list" data-component="item-list">
      <h2>Tech Stack</h2>

      <div class="item-filters" data-filter={{this.selectedCategory}}>
        {{#each this.categories as |category|}}
          <button
            type="button"
            data-category={{category}}
            {{on "click" (fn this.selectCategory category)}}
          >
            {{category}}
          </button>
        {{/each}}
      </div>

      <p data-item-count={{this.filteredCount}}>
        Showing {{this.filteredCount}} of {{this.items.length}} items
      </p>

      {{#if this.filteredItems.length}}
        <ul class="item-entries">
          {{#each this.filteredItems key="id" as |item|}}
            <li data-item-id={{item.id}} data-item-category={{item.category}}>
              {{item.name}}
              <span class="item-category">({{item.category}})</span>
            </li>
          {{/each}}
        </ul>
      {{else}}
        <p class="no-items">No items match the selected filter.</p>
      {{/if}}
    </div>
  </template>
}
