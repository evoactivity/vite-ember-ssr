import Route from '@ember/routing/route';
import { service } from '@ember/service';
import type Store from '../../services/store.ts';

export default class PokemonWarpDriveShowRoute extends Route {
  @service declare store: Store;

  async model(params: { name: string }) {
    const request = this.store.request({
      url: `https://pokeapi.co/api/v2/pokemon/${params.name}`,
    });

    // During SSR, await so the HTML includes actual content.
    // On the client, let <Request> handle it reactively.
    if (import.meta.env.SSR) {
      await request;
    }

    return { request };
  }
}
