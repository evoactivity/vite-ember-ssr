import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { query } from '@warp-drive/utilities/json-api';
import type Store from '../services/store.ts';

export default class PokemonWarpDriveRoute extends Route {
  @service declare store: Store;

  async model() {
    const request = this.store.request(
      query('pokemon', { limit: '12' }, { resourcePath: 'pokemon' }),
    );

    // During SSR, await so the HTML includes actual content.
    // On the client, let <Request> handle it reactively.
    if (import.meta.env.SSR) {
      await request;
    }

    return { request };
  }
}
