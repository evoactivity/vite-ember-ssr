import { pageTitle } from 'ember-page-title';
import testLogo from '../assets/test-logo.png';

<template>
  {{pageTitle "TestApp"}}

  {{outlet}}

  <main>
    <h1>vite-ember-ssr</h1>
    <p>Server-side rendered Ember application.</p>
    <img src={{testLogo}} alt="Test logo" width="64" height="64" />
  </main>
</template>
