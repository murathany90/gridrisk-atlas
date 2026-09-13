// three guncellemelerinde vendor kopyasini yeniler: npm run sync-vendor
import { copyFileSync } from 'node:fs';
copyFileSync('node_modules/three/build/three.module.min.js', 'vendor/three.module.min.js');
copyFileSync('node_modules/three/LICENSE', 'vendor/LICENSE.three.txt');
console.log('vendor senkronize edildi.');
