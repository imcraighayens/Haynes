import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'za.co.quik1.app',
  appName: 'Quik1',
  webDir: 'dist',
  backgroundColor: '#000000',
  plugins: {
    // Launch screen: plain black, no image (Craig, 13 Oct 2026). The in-app
    // splash (wordmark + progress) takes over once the web view is ready.
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#000000',
      showSpinner: false,
      androidScaleType: 'CENTER',
    },
    StatusBar: { style: 'DARK', backgroundColor: '#000000', overlaysWebView: false },
  },
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: false },
};

export default config;
