import testLogo from '../assets/test-logo.png';
import CounterDisplay from '../components/counter-display.gts';
import ItemList from '../components/item-list.gts';

<template>
  <main data-route="index">
    <h1>Welcome to vite-ember-ssr</h1>
    <p>Server-side rendered Ember application.</p>
    <img src={{testLogo}} alt="Test logo" width="64" height="64" />

    <CounterDisplay />
    <ItemList />
  </main>
</template>
