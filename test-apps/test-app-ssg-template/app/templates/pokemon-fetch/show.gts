<template>
  <div data-route="pokemon-fetch.show" data-pokemon-name={{@model.name}}>
    <h2>{{@model.name}}</h2>

    {{#if @model.sprite}}
      <img
        src={{@model.sprite}}
        alt={{@model.name}}
        width="96"
        height="96"
        data-sprite
      />
    {{/if}}

    <dl class="pokemon-details">
      <dt>ID</dt>
      <dd data-field="id">{{@model.id}}</dd>

      <dt>Height</dt>
      <dd data-field="height">{{@model.height}}</dd>

      <dt>Weight</dt>
      <dd data-field="weight">{{@model.weight}}</dd>

      <dt>Types</dt>
      <dd data-field="types">
        {{#each @model.types as |type|}}
          <span class="pokemon-type" data-type={{type}}>{{type}}</span>
        {{/each}}
      </dd>

      <dt>Abilities</dt>
      <dd data-field="abilities">
        {{#each @model.abilities as |ability|}}
          <span class="pokemon-ability" data-ability={{ability}}>{{ability}}</span>
        {{/each}}
      </dd>

      <dt>Stats</dt>
      <dd data-field="stats">
        <ul>
          {{#each @model.stats as |stat|}}
            <li data-stat={{stat.name}}>
              {{stat.name}}: {{stat.value}}
            </li>
          {{/each}}
        </ul>
      </dd>
    </dl>
  </div>
</template>
