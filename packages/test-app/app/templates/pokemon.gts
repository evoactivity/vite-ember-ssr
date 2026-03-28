import { LinkTo } from '@ember/routing';

<template>
  <main data-route="pokemon">
    <h1>Pokémon</h1>

    <ul class="pokemon-list" data-component="pokemon-list">
      {{#each @model as |pokemon|}}
        <li data-pokemon={{pokemon.name}}>
          <LinkTo @route="pokemon.show" @model={{pokemon.name}}>
            {{pokemon.name}}
          </LinkTo>
        </li>
      {{/each}}
    </ul>

    {{outlet}}
  </main>
</template>
