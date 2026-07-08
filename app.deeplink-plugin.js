const {
  withEntitlementsPlist,
  withAndroidManifest,
} = require('@expo/config-plugins');

const ASSOCIATED_DOMAIN = 'applinks:samplefinder.com';

/**
 * iOS: Add Associated Domains entitlement for Universal Links.
 */
const withAssociatedDomains = (config) => {
  return withEntitlementsPlist(config, (mod) => {
    const entitlements = mod.modResults;
    const existingDomains = entitlements['com.apple.developer.associated-domains'] ?? [];

    if (!existingDomains.includes(ASSOCIATED_DOMAIN)) {
      entitlements['com.apple.developer.associated-domains'] = [
        ...existingDomains,
        ASSOCIATED_DOMAIN,
      ];
    }

    return mod;
  });
};

/**
 * Android: Add intent-filter with autoVerify for App Links.
 */
const withDeepLinkIntentFilter = (config) => {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return mod;

    const mainActivity = application.activity?.find(
      (activity) => activity.$?.['android:name'] === '.MainActivity',
    );
    if (!mainActivity) return mod;

    if (!mainActivity['intent-filter']) {
      mainActivity['intent-filter'] = [];
    }

    // Check if we already added the deep link intent-filter
    const alreadyAdded = mainActivity['intent-filter'].some((filter) => {
      const data = filter.data?.[0]?.$;
      return (
        data?.['android:host'] === 'samplefinder.com' &&
        data?.['android:pathPrefix'] === '/referral/'
      );
    });

    if (!alreadyAdded) {
      mainActivity['intent-filter'].push({
        $: { 'android:autoVerify': 'true' },
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
          { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
        ],
        data: [
          {
            $: {
              'android:scheme': 'https',
              'android:host': 'samplefinder.com',
              'android:pathPrefix': '/referral/',
            },
          },
        ],
      });
    }

    return mod;
  });
};

/**
 * Combined config plugin for deep linking (Universal Links + App Links).
 */
const withDeepLinking = (config) => {
  // Staging is custom-scheme only (see app.config.js `scheme`). Skip Associated
  // Domains (iOS) and the autoVerify App Link (Android) so staging never competes
  // with the prod app for samplefinder.com links.
  if (process.env.APP_VARIANT === 'staging') {
    return config;
  }
  config = withAssociatedDomains(config);
  config = withDeepLinkIntentFilter(config);
  return config;
};

module.exports = withDeepLinking;
