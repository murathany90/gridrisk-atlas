// GridAtlas 3D v0.4 — src/ui/tabs.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { $ } from '../core/utils.js';
import { state } from '../core/state.js';

function setBottomTab(tab){state.bottom=tab;$('#sld-container').classList.toggle('hidden',tab!=='sld');$('#events').classList.toggle('hidden',tab!=='events');$$('[data-bottom-tab]').forEach(b=>b.classList.toggle('active',b.dataset.bottomTab===tab));if(document.body.classList.contains('bottom-minimized'))document.body.classList.remove('bottom-minimized');}

export { setBottomTab };
