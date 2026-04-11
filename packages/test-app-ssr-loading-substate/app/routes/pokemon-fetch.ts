import Route from '@ember/routing/route';

const wait = () => new Promise((resolve) => setTimeout(resolve, 2000));

export default class PokemonFetchRoute extends Route {
  async model() {
    const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=12');
    const data = await response.json();
    return wait().then(() => data.results);
  }
}
