/**
 * WarpDrive request handler for the PokeAPI.
 *
 * Delegates fetching to the next handler in the chain (the
 * built-in Fetch handler provided by useLegacyStore), then
 * normalizes the response into JSON:API format for WarpDrive's
 * cache.
 */
import type {
  Handler,
  RequestContext,
  NextFn,
} from '@warp-drive/core/types/request';

const POKEAPI_HOST = 'https://pokeapi.co';

export const PokeApiHandler: Handler = {
  async request<T>(context: RequestContext, next: NextFn<T>): Promise<T> {
    const { url } = context.request;

    if (!url || !url.startsWith(POKEAPI_HOST)) {
      return next(context.request);
    }

    const result = await next(context.request);
    const data = result.content as any;

    // Detect if this is a list response (has `results` array)
    // or a single pokemon detail response (has `id` field)
    if (data.results) {
      return normalizeList(data) as T;
    }

    return normalizeDetail(data) as T;
  },
};

/**
 * Normalize the PokeAPI list response:
 *   { results: [{ name: "bulbasaur", url: "..." }, ...] }
 * into JSON:API:
 *   { data: [{ type: "pokemon", id: "bulbasaur", attributes: { name: "bulbasaur" } }, ...] }
 */
function normalizeList(raw: any) {
  return {
    data: raw.results.map((item: any) => ({
      type: 'pokemon',
      id: item.name,
      attributes: {
        name: item.name,
      },
    })),
  };
}

/**
 * Normalize a single PokeAPI pokemon response into JSON:API:
 *   { data: { type: "pokemon", id: "pikachu", attributes: { ... } } }
 */
function normalizeDetail(raw: any) {
  return {
    data: {
      type: 'pokemon',
      id: raw.name,
      attributes: {
        name: raw.name,
        sprite: raw.sprites.front_default,
        height: raw.height,
        weight: raw.weight,
        types: raw.types.map((t: any) => t.type.name),
        abilities: raw.abilities.map((a: any) => a.ability.name),
        stats: raw.stats.map((s: any) => ({
          name: s.stat.name,
          value: s.base_stat,
        })),
      },
    },
  };
}
