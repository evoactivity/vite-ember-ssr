import { LinkTo } from "@ember/routing";

<template>
  <nav data-component="navigation">
    <LinkTo @route="index">Home</LinkTo>
    <LinkTo @route="about">About</LinkTo>
    <LinkTo @route="contact">Contact</LinkTo>
  </nav>

  {{outlet}}
</template>
