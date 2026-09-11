// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  vite: {
    envPrefix: ['PUBLIC_', 'GHWM_'],
    plugins: [tailwindcss()]
  }
});
