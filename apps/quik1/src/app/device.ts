// Small device-local store: a stable device id (for PIN-on-trusted-device) and
// the last phone number used. Nothing sensitive. Native builds swap in
// Capacitor Preferences via setDeviceStore().
export interface DeviceStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const web: DeviceStore = {
  async get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  async set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  async remove(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

let store: DeviceStore = web;
export const setDeviceStore = (s: DeviceStore) => { store = s; };
export const deviceStore = () => store;

export async function deviceId(): Promise<string> {
  let id = await store.get('quik1.device');
  if (!id) {
    id = crypto.randomUUID() + crypto.randomUUID();
    await store.set('quik1.device', id);
  }
  return id;
}
