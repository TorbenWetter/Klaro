import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'Klaro',
    permissions: ['sidePanel', 'activeTab', 'storage', 'tabs'],
    action: {
      default_title: 'Open Klaro',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        $lib: path.resolve('./src/lib'),
      },
    },
  }),
});
