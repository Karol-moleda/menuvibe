import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pl.karol.menuvibe',
  appName: 'MenuVibe',
  webDir: 'dist/menuvibe/browser',
  android: {
    // tylko HTTPS do Supabase i Open Food Facts
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 500 },
  },
};

export default config;
