import Route from '@ember/routing/route';
import { service } from '@ember/service';
import type Store from '../services/store.ts';

export default class PokemonWarpDriveRoute extends Route {
  @service declare store: Store;

  model() {
    return {
      request: this.store.request({
        url: 'https://pokeapi.co/api/v2/pokemon?limit=12',
      }),
    };
  }
}
