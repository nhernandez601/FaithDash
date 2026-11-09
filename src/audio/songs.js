// The two songs as asset URLs (Vite turns each into a hashed file, or inlines it in the single-file build).
import dropUrl from '../assets/music/arcade-drop.mp3?url';
import bossUrl from '../assets/music/arcade-boss-battle.mp3?url';
import intenseUrl from '../assets/music/intense-section.mp3?url';
export const SONG_URLS = { drop: dropUrl, boss: bossUrl, intense: intenseUrl };
