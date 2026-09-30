function headElement(): Element {
  return document.head;
}

<template>
  {{#in-element (headElement) insertBefore=null}}
    <meta name="route-head" content={{@route}} />
  {{/in-element}}
</template>
