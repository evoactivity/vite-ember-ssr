import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { findRecord } from '@warp-drive/utilities/json-api';
import type Store from '../../services/store.ts';

export default class PokemonWarpDriveShowRoute extends Route {
  @service declare store: Store;

  async model(params: { name: string }) {
    const request = this.store.request(
      findRecord('pokemon', params.name, { resourcePath: 'pokemon' }),
    );

    // During SSR, await so the HTML includes actual content.
    // On the client, let <Request> handle it reactively.
    if (import.meta.env.SSR) {
      await request;
    }

    return { request };
  }
}
