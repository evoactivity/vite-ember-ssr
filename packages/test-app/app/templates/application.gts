import { pageTitle } from 'ember-page-title';

<template>
  {{pageTitle "TestApp"}}

  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
  </nav>

  {{outlet}}
</template>
