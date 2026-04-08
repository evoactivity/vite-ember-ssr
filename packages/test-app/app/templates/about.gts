import CounterDisplay from '../components/counter-display.gts';
import { modifier } from 'ember-modifier';

const doThing = modifier((element) => {
  element.textContent = 'This div was modified by an Ember modifier!';
});

<template>
  <main data-route="about">
    <h1>About</h1>
    <p>This is a test application for vite-ember-ssr.</p>
    <p>It demonstrates server-side rendering of Ember applications using HappyDOM.</p>

    <div {{doThing}}>hi</div>

    <CounterDisplay />
  </main>
</template>
