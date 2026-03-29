//
// https://github.com/embroider-build/embroider/issues/2521

declare global {
  interface Window {
    _embroiderRouteBundles_: Array<{
      names: string[];
      load: () => Promise<Record<string, unknown>>;
    }>;
  }
}

window._embroiderRouteBundles_ = [];

/**
 * Create a route bundle for Embroider route-based code splitting.
 *
 * The loader function should return an array of import() promises in the order:
 * [template, route?, controller?]. Only the template is required.
 *
 * Using a loader function with static import() paths ensures Vite can properly
 * code-split without eagerly loading all chunks.
 */
export function bundle(
  name: string,
  loader: () => Promise<{ default: unknown }>[]
) {
  return {
    names: [name],
    load: async () => {
      const [template, route, controller] = await Promise.all(loader());
      const slashName = name.replaceAll('.', '/');
      const results: Record<string, unknown> = {};

      if (template) results[`./templates/${slashName}`] = template.default;
      if (route) results[`./routes/${slashName}`] = route.default;
      if (controller)
        results[`./controllers/${slashName}`] = controller.default;

      return {
        default: results,
      };
    },
  };
}
