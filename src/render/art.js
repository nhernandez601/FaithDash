// Creator-supplied artwork. Every image is optional: if one fails to load, the game falls back to the drawn art.
import menu from '../assets/menu.jpg';
import logo from '../assets/logo.webp';
import coin from '../assets/coin.webp';
import bg0 from '../assets/bg0.jpg';
import bg1 from '../assets/bg1.jpg';
import bg2 from '../assets/bg2.jpg';
import tex0 from '../assets/tex0.jpg';
import tex1 from '../assets/tex1.jpg';
import tex2 from '../assets/tex2.jpg';
import skin_radiant from '../assets/skin_radiant.webp';
import skin_guardian from '../assets/skin_guardian.webp';
import skin_crimson from '../assets/skin_crimson.webp';
import skin_angelic from '../assets/skin_angelic.webp';
import skin_flame from '../assets/skin_flame.webp';
import skin_prism from '../assets/skin_prism.webp';

const SRC = { menu, logo, coin, bg0, bg1, bg2, tex0, tex1, tex2, skin_radiant, skin_guardian, skin_crimson, skin_angelic, skin_flame, skin_prism };

export const art = {
  img: {}, ok: {}, disabled: false,
  has(k) { return !this.disabled && !!this.ok[k]; },
  w(k) { return this.img[k].naturalWidth; },
  h(k) { return this.img[k].naturalHeight; },
  url(k) { return SRC[k]; },
};
export function loadArt() {
  return Promise.all(Object.keys(SRC).map((k) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { art.img[k] = im; art.ok[k] = true; res(); };
    im.onerror = () => { console.warn('[art] could not load', k); res(); };
    im.src = SRC[k];
  })));
}
