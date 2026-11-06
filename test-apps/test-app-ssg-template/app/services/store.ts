import { useLegacyStore } from '@warp-drive/legacy';
import { JSONAPICache } from '@warp-drive/json-api';
import { PokeApiHandler } from '../handlers/pokeapi.ts';
import { PokemonSchema } from '../schemas/pokemon.ts';

const Store = useLegacyStore({
  linksMode: true,
  cache: JSONAPICache,
  handlers: [PokeApiHandler],
  schemas: [PokemonSchema],
});

type Store = InstanceType<typeof Store>;

export default Store;
