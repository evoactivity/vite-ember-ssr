const ENV = {
  modulePrefix: 'test-app-monorepo-ssg',
  environment: import.meta.env?.DEV ? 'development' : 'production',
  rootURL: '/',
  locationType: 'history',
  EmberENV: {},
  APP: {},
};

export default ENV;
