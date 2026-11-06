import Application from '@ember/application';

import { customLayout } from './custom-layout.ts';

/**
 * Only the eager routes are listed here.
 *
 * The about and contact routes load lazily.
 * See router.ts.
 */
export default class App extends Application {
  modules = {
    ...import.meta.glob('./router.*', { eager: true }),
    ...customLayout(
      import.meta.glob(
        './routes/{application,index}/+{route,template}.{ts,gts}',
        {
          eager: true,
        },
      ),
    ),
  };
}
