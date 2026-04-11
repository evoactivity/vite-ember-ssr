import { action } from '@ember/object';
import Route from '@ember/routing/route';

const wait = () => new Promise((resolve) => setTimeout(resolve, 2000));
export default class PokemonFetchShowRoute extends Route {
  async model(params: { name: string }) {
    const response = await fetch(
      `https://pokeapi.co/api/v2/pokemon/${params.name}`,
    );

    const data = await response.json();

    return wait().then(() => ({
      name: data.name,
      id: data.id,
      sprite: data.sprites.front_default,
      types: data.types.map((t: any) => t.type.name),
      abilities: data.abilities.map((a: any) => a.ability.name),
      height: data.height,
      weight: data.weight,
      stats: data.stats.map((s: any) => ({
        name: s.stat.name,
        value: s.base_stat,
      })),
    }));
  }

  @action
  loading() {
    console.log('loading substate');
    return true;
  }
}
