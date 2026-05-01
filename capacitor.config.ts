import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mkm.ai.chat',
  appName: 'MKM AI Chat',
  webDir: '.',
  server: {
    androidScheme: 'https'
  }
};

export default config;
