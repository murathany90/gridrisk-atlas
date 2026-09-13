import { defineConfig } from 'vite';

// Faz 1: basit statik build. Kaynak giriş noktası GridAtlas3D/index.html olarak kalır,
// böylece ana uygulamanın `GridAtlas3D/index.html?embed=1&country=..&lang=..` erişimi bozulmaz.
// Üretimde kaynak index.html doğrudan statik sunucuyla çalışır (importmap -> ./vendor/three.module.min.js);
// `npm run build` çıktısı (dist/) doğrulama ve ilerideki dağıtım içindir.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 5173
  }
});
