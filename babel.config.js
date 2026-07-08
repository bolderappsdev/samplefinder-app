module.exports = function (api) {
  const variant = process.env.APP_VARIANT === 'staging' ? 'staging' : 'production';
  const envFile = variant === 'staging' ? '.env.staging' : '.env';

  // Expo's @expo/env auto-loads `.env` (prod values) into process.env at CLI startup,
  // and react-native-dotenv gives process.env precedence over its `path` file. Without
  // this, a staging build silently inlines PROD @env values (e.g. the prod Appwrite
  // project id) even though babel correctly selects .env.staging. For staging, re-load
  // .env.staging into process.env with override so react-native-dotenv reads staging
  // values. Prod is intentionally left untouched.
  if (variant === 'staging') {
    require('dotenv').config({ path: require('path').join(__dirname, envFile), override: true });
  }

  // Invalidate the Babel cache when the ACTIVE env file (or the variant) changes,
  // so react-native-dotenv picks up new values without a manual cache wipe.
  api.cache.using(() => {
    try {
      return variant + ':' + require('fs').readFileSync(require('path').join(__dirname, envFile), 'utf8');
    } catch {
      return variant + ':';
    }
  });

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
            '@/components': './src/components',
            '@/screens': './src/screens',
            '@/navigation': './src/navigation',
            '@/utils': './src/utils',
            '@/assets': './src/assets',
          },
          extensions: [
            '.ios.ts', '.android.ts', '.ts',
            '.ios.tsx', '.android.tsx', '.tsx',
            '.jsx', '.js', '.json',
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
          ],
        },
      ],
      [
        'module:react-native-dotenv',
        {
          moduleName: '@env',
          path: envFile,
          allowUndefined: true,
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};

