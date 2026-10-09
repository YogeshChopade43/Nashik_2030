import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves the site under /<repo>/; the deploy workflow sets PAGES_BASE=/Nashik_2030/.
export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react(), tailwindcss()],
});
