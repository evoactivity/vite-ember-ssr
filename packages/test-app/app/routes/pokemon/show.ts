import Route from '@ember/routing/route';

export default class PokemonShowRoute extends Route {
  async model(params: { name: string }) {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${params.name}`);
    const data = await response.json();

    return {
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
    };
  }
}
