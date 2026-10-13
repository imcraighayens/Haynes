// Native (Capacitor) wiring. On the web this does nothing.
import { Capacitor } from '@capacitor/core';
import { setDeviceStore } from './app/device';
import { setBiometric } from './app/biometric';

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  const [{ Preferences }, { StatusBar, Style }, { SplashScreen }, { BiometricAuth }] = await Promise.all([
    import('@capacitor/preferences'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
    import('@aparajita/capacitor-biometric-auth'),
  ]);
  setDeviceStore({
    get: async (key) => (await Preferences.get({ key })).value,
    set: (key, value) => Preferences.set({ key, value }),
    remove: (key) => Preferences.remove({ key }),
  });
  setBiometric(async () => {
    try {
      const info = await BiometricAuth.checkBiometry();
      if (!info.isAvailable) return false;
      await BiometricAuth.authenticate({ reason: 'Sign in to Quik1', cancelTitle: 'Cancel', allowDeviceCredential: false, androidTitle: 'Quik1' });
      return true;
    } catch {
      return false;
    }
  });
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  await SplashScreen.hide().catch(() => {});
}
