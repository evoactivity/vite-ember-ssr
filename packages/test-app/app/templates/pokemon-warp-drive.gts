import { LinkTo } from '@ember/routing';
import { Request } from '@warp-drive/ember';
import { on } from '@ember/modifier';

<template>
  <main data-route="pokemon-warp-drive">
    <h1>Pokémon (WarpDrive)</h1>

    <Request @request={{@model.request}}>
      <:loading>
        <p data-loading>Loading Pokémon...</p>
      </:loading>

      <:error as |error state|>
        <p data-error>Error: {{error.message}}</p>
        <button {{on "click" state.retry}} data-retry>Retry</button>
      </:error>

      <:content as |result|>
        <ul class="pokemon-list" data-component="pokemon-list">
          {{#each result.data as |pokemon|}}
            <li data-pokemon={{pokemon.name}}>
              <LinkTo @route="pokemon-warp-drive.show" @model={{pokemon.name}}>
                {{pokemon.name}}
              </LinkTo>
            </li>
          {{/each}}
        </ul>
      </:content>
    </Request>

    {{outlet}}
  </main>
</template>
