import CounterDisplay from '../components/counter-display.gts';
import AboutInfo from '../components/about-info.gts';
import SharedBadge from '../components/shared-badge.gts';
import './about.css';

<template>
  <main data-route="about">
    <h1>About <SharedBadge>lazy</SharedBadge></h1>
    <p>This is a test application for vite-ember-ssr.</p>
    <p>It demonstrates server-side rendering of Ember applications using HappyDOM.</p>

    <AboutInfo />
    <CounterDisplay />
  </main>
</template>
