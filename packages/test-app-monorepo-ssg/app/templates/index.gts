import MonorepoStatus from '../components/monorepo-status.gts';

<template>
  <main data-route="index">
    <h1>Monorepo SSG Test</h1>
    <p>Tests that sibling workspace packages importing @glimmer/tracking work in SSG builds.</p>

    <MonorepoStatus />
  </main>
</template>
