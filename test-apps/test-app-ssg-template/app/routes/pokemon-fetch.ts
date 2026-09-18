import Route from '@ember/routing/route';

export default class PokemonFetchRoute extends Route {
  async model() {
    const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=12');
    const data = await response.json();
    return data.results;
  }
}
