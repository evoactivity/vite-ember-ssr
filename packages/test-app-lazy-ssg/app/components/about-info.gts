import Component from '@glimmer/component';
import './about-info.css';

/**
 * Component used only by the about route.
 *
 * Tests transitive CSS injection: when a lazy-loaded route template
 * imports a component that itself imports CSS, the component's CSS
 * should appear in the route's chunk and end up in the CSS manifest.
 */
export default class AboutInfo extends Component {
  <template>
    <div class="about-info" data-component="about-info">
      <p class="about-info__title">About Info Component</p>
      <p>This component has its own CSS imported via the component file.</p>
    </div>
  </template>
}
