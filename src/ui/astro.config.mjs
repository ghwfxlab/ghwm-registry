// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: process.env.ASTRO_SITE || 'https://ghwfxlab.github.io',
  base: process.env.ASTRO_BASE || (process.env.NODE_ENV === 'production' ? '/ghwm' : '/'),
  vite: {
    envPrefix: ['PUBLIC_', 'GHWM_', 'ASTRO_'],
    plugins: [tailwindcss()]
  }
});
