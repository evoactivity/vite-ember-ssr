import Component from '@ember/component';
import './legacy-notice.css';

/**
 * A legacy @ember/component component used to verify that classic
 * components work correctly in the SSR/SSG build pipeline.
 *
 * Uses tagName = '' to opt out of the legacy wrapper element, which
 * is the recommended pattern for classic components in GTS files.
 */
export default class LegacyNotice extends Component {
  tagName = '';

  <template>
    <div class="legacy-notice" data-component="legacy-notice">
      <p class="legacy-notice__title">Legacy Component</p>
      <p>This component extends @ember/component (classic).</p>
    </div>
  </template>
}
