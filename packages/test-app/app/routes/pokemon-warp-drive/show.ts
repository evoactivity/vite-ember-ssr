import Route from '@ember/routing/route';
import { service } from '@ember/service';
import type Store from '../../services/store.ts';

export default class PokemonWarpDriveShowRoute extends Route {
  @service declare store: Store;

  model(params: { name: string }) {
    return {
      request: this.store.request({
        url: `https://pokeapi.co/api/v2/pokemon/${params.name}`,
      }),
    };
  }
}
