import type { ResourceSchema } from '@warp-drive/core/types/schema';

export const PokemonSchema: ResourceSchema = {
  type: 'pokemon',
  identity: { kind: '@id', name: 'id' },
  fields: [
    { kind: 'field', name: 'name' },
    { kind: 'field', name: 'sprite' },
    { kind: 'field', name: 'height' },
    { kind: 'field', name: 'weight' },
    { kind: 'field', name: 'types' },
    { kind: 'field', name: 'abilities' },
    { kind: 'field', name: 'stats' },
  ],
};
