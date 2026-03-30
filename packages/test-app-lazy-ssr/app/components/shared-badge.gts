import Component from '@glimmer/component';
import './shared-badge.css';

/**
 * A shared component with its own CSS, used by multiple lazy routes.
 *
 * Tests that Vite correctly handles CSS deduplication when a component
 * with CSS imports is shared across multiple code-split chunks.
 */
export default class SharedBadge extends Component {
  <template>
    <span class="shared-badge" data-component="shared-badge">
      {{yield}}
    </span>
  </template>
}
