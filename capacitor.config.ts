import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zelvyra.controlfinanciero',
  appName: 'ZELVYRA',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: { androidScheme: 'https' }
};

export default config;
