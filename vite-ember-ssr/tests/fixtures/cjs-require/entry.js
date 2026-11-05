// A CommonJS package whose entry require()s another of its files (as
// remark-parse@8 does), bundled into an SSR build.
import value from 'cjs-chain';

export const result = value;
