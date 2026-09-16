import Component from "@glimmer/component";

import "./info.css";

/**
 * A component that only the about route uses.
 *
 * Its CSS must end up in the about chunk and in the CSS manifest.
 */
export default class Info extends Component {
  <template>
    <div class="about-info" data-component="about-info">
      <p>A route-only component, next to its route.</p>
    </div>
  </template>
}
