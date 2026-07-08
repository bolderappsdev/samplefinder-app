// Dynamic Expo config. Reads static app.json (as `config`) and applies staging
// overrides when APP_VARIANT=staging. NOTE: under the "never prebuild" release
// model, this drives `expo start` dev + is the declarative mirror of the native
// project; the signed release artifacts come from the Android flavor / iOS scheme.
const IS_STAGING = process.env.APP_VARIANT === 'staging';

module.exports = ({ config }) => {
  if (!IS_STAGING) {
    return config; // production: unchanged
  }

  return {
    ...config,
    name: 'SampleFinder (Staging)',
    scheme: 'samplefinderstaging',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.samplefinder.app.staging',
      googleServicesFile: './GoogleService-Info.staging.plist',
      // Staging uses a custom scheme only — drop universal links so it never
      // competes with the prod app for samplefinder.com.
      associatedDomains: undefined,
    },
    android: {
      ...config.android,
      package: 'com.samplefinder.app.staging',
      googleServicesFile: './google-services.staging.json',
    },
  };
};
