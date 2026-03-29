import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import { cleanupSSRContent } from 'vite-ember-ssr/client';

<template>
  {{pageTitle "TestApp"}}
  {{cleanupSSRContent}}

  <nav data-component="navigation">
    <LinkTo @route="index">Home</LinkTo>
    <LinkTo @route="about">About</LinkTo>
    <LinkTo @route="contact">Contact</LinkTo>
    <LinkTo @route="pokemon-fetch">Pokémon (Fetch)</LinkTo>
    <LinkTo @route="pokemon-warp-drive">Pokémon (WarpDrive)</LinkTo>
  </nav>

  {{outlet}}
</template>
