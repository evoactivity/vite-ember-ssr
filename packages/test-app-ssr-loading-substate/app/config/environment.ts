const ENV = {
  modulePrefix: 'test-app',
  environment: import.meta.env?.DEV ? 'development' : 'production',
  rootURL: '/',
  locationType: 'history',
  EmberENV: {},
  APP: {
    LOG_ROUTE_TRANSITIONS: true,
  },
};

export default ENV;
