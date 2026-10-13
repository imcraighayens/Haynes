import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import '../design/global.css';
import './generated/pseudo.css';
import { App } from './app/App';
import { initNative } from './native';

void initNative();
createRoot(document.getElementById('dc-root')!).render(<App />);

// Installable web app (not inside the native shells, not in dev).
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
