import SharedBadge from "#components/shared-badge.gts";

import Info from "./info.gts";
import "./about.css";

<template>
  <main data-route="about">
    <h1>About <SharedBadge>lazy</SharedBadge></h1>
    <p>This route's template, component, and CSS live together.</p>

    <Info />
  </main>
</template>
