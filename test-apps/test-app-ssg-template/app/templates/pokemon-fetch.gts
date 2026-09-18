import { LinkTo } from '@ember/routing';

<template>
  <main data-route="pokemon-fetch">
    <h1>Pokémon (Fetch)</h1>

    <ul class="pokemon-list" data-component="pokemon-list">
      {{#each @model as |pokemon|}}
        <li data-pokemon={{pokemon.name}}>
          <LinkTo @route="pokemon-fetch.show" @model={{pokemon.name}}>
            {{pokemon.name}}
          </LinkTo>
        </li>
      {{/each}}
    </ul>

    {{outlet}}
  </main>
</template>
