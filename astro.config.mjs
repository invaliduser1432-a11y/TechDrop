import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  output: 'server',
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
