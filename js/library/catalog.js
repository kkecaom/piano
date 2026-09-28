// The song library.
//
// "Your collection" is the list of songs you asked for. They are modern, copyrighted works, so
// Nocturne does not ship their notes. Each one is a slot: attach a MIDI arrangement you
// own or have licensed (for example one you bought, transcribed, or exported from your
// notation software) and the piano will perform it, visualise it, and remember it on
// this device.
//
// The built-in pieces are public-domain classics and original music, rendered with
// expressive timing, dynamics and pedalling.

import { bachPrelude } from '../music/pieces/bach-prelude.js';
import { furElise } from '../music/pieces/fur-elise.js';
import { canonInD } from '../music/pieces/canon.js';
import { paperLanterns, letterNeverSent } from '../music/pieces/originals.js';

export const COLLECTION = [
  { id: 'slot-truth', title: 'Truth That You Leave Me', subtitle: '', aliases: ['truth that you leave', 'the truth that you leave', '你离开的真相'] },
  { id: 'slot-juebieshu', title: '诀别书', subtitle: '', aliases: ['诀别书', 'juebieshu', 'jue bie shu', 'farewell letter'] },
  { id: 'slot-instellar', title: 'Interstellar', subtitle: 'Hans Zimmer', aliases: ['interstellar', 'in stellar', 'instellar', '星际穿越'] },
  { id: 'slot-lawrence', title: 'Merry Christmas, Mr. Lawrence', subtitle: 'Ryuichi Sakamoto', aliases: ['merry christmas mr lawrence', 'mr lawrence', 'mr. lawrence', 'lawrence', '圣诞快乐劳伦斯先生', '戦場のメリークリスマス'] },
  { id: 'slot-sacred', title: 'Sacred Play Secret Place', subtitle: 'Matryoshka', aliases: ['sacred play secret place', 'sacred play', 'secret place'] },
  { id: 'slot-silence', title: 'Call of Silence', subtitle: 'Hiroyuki Sawano', aliases: ['call of silence', 'callofsilence', 'call-of-silence'] },
  { id: 'slot-mariage', title: '梦中的婚礼', subtitle: "Mariage d'Amour", aliases: ['梦中的婚礼', 'mariage d amour', "mariage d'amour", 'mariage damour', 'mariage', 'wedding in a dream'] },
  { id: 'slot-adeline', title: '水边的阿丽丽娜', subtitle: 'Ballade pour Adeline', aliases: ['水边的阿丽丽娜', '水边的阿狄丽娜', '阿狄丽娜', '阿丽丽娜', 'ballade pour adeline', 'adeline', 'adelina'] },
];

// Slots that were merged into another one: files saved under the old id move to the new slot.
export const MERGED_SLOTS = { 'slot-secret': 'slot-sacred' };

export const CLASSICS = [
  { id: 'bach-846', build: bachPrelude, title: 'Prelude in C major, BWV 846', subtitle: 'J. S. Bach' },
  { id: 'fur-elise', build: furElise, title: 'Für Elise', subtitle: 'L. van Beethoven' },
  { id: 'canon-d', build: canonInD, title: 'Canon in D', subtitle: 'J. Pachelbel · piano arrangement' },
];

export const ORIGINALS = [
  { id: 'paper-lanterns', build: paperLanterns, title: 'Paper Lanterns', subtitle: 'Nocturne original' },
  { id: 'letter-never-sent', build: letterNeverSent, title: 'Letter Never Sent', subtitle: 'Nocturne original' },
];

const normalize = (s) => s.toLowerCase()
  .replace(/\.(mid|midi|kar|rmi)$/i, '')
  .replace(/[_\-.,'’()[\]{}!?]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Find the collection slot a file most likely belongs to, by its file name. */
export function matchSlot(fileName) {
  const n = normalize(fileName);
  const compact = n.replace(/\s/g, '');
  let best = null;
  let bestLen = 0;
  for (const slot of COLLECTION) {
    for (const alias of [slot.title, ...slot.aliases]) {
      const a = normalize(alias);
      if (!a) continue;
      if ((n.includes(a) || compact.includes(a.replace(/\s/g, ''))) && a.length > bestLen) {
        best = slot;
        bestLen = a.length;
      }
    }
  }
  return best;
}

export function titleFromFileName(fileName) {
  const base = fileName.replace(/\.(mid|midi|kar|rmi)$/i, '').replace(/[_]+/g, ' ').trim();
  return base || 'Untitled';
}
