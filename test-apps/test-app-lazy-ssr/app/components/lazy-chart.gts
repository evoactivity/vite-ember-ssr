import Component from '@glimmer/component';
import './lazy-chart.css';

/**
 * Component that is only ever loaded with `import()` at render time.
 *
 * Vite builds it into its own chunk with its own CSS, separate from the
 * about route chunk. See lazy-loader.gts.
 */
export default class LazyChart extends Component {
  <template>
    <div class="lazy-chart" data-component="lazy-chart">
      <p>This component was loaded lazily while the route rendered.</p>
    </div>
  </template>
}
