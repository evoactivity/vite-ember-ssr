/**
 * `@nullvoxpopuli/ember-vite` calls `RegExp.escape`, which Node 22 lacks
 * (it was added in Node 24). This adds a minimal version so the app also
 * builds on Node 22. It escapes regex syntax characters, which is enough
 * for the file extensions the tooling passes in.
 */
if (typeof RegExp.escape !== 'function') {
  RegExp.escape = (value) =>
    String(value).replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}
