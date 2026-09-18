import { Request } from '@warp-drive/ember';
import { on } from '@ember/modifier';

<template>
  <Request @request={{@model.request}}>
    <:loading>
      <p data-loading>Loading Pokémon details...</p>
    </:loading>

    <:error as |error state|>
      <p data-error>Error: {{error.message}}</p>
      <button {{on "click" state.retry}} data-retry>Retry</button>
    </:error>

    <:content as |result|>
      <div data-route="pokemon-warp-drive.show" data-pokemon-name={{result.data.name}}>
        <h2>{{result.data.name}}</h2>

        {{#if result.data.sprite}}
          <img
            src={{result.data.sprite}}
            alt={{result.data.name}}
            width="96"
            height="96"
            data-sprite
          />
        {{/if}}

        <dl class="pokemon-details">
          <dt>ID</dt>
          <dd data-field="id">{{result.data.id}}</dd>

          <dt>Height</dt>
          <dd data-field="height">{{result.data.height}}</dd>

          <dt>Weight</dt>
          <dd data-field="weight">{{result.data.weight}}</dd>

          <dt>Types</dt>
          <dd data-field="types">
            {{#each result.data.types as |type|}}
              <span class="pokemon-type" data-type={{type}}>{{type}}</span>
            {{/each}}
          </dd>

          <dt>Abilities</dt>
          <dd data-field="abilities">
            {{#each result.data.abilities as |ability|}}
              <span class="pokemon-ability" data-ability={{ability}}>{{ability}}</span>
            {{/each}}
          </dd>

          <dt>Stats</dt>
          <dd data-field="stats">
            <ul>
              {{#each result.data.stats as |stat|}}
                <li data-stat={{stat.name}}>
                  {{stat.name}}: {{stat.value}}
                </li>
              {{/each}}
            </ul>
          </dd>
        </dl>
      </div>
    </:content>
  </Request>
</template>
