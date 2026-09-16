import Component from "@glimmer/component";

import "./shared-badge.css";

/**
 * A shared component with its own CSS, used by both lazy routes.
 */
export default class SharedBadge extends Component {
  <template>
    <span class="shared-badge" data-component="shared-badge">
      {{yield}}
    </span>
  </template>
}
