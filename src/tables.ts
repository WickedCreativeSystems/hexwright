// Your own encounter table: a note whose list items are the things the party can meet on the road.
// Items under a heading named for a terrain (## Forest) are met only there; items anywhere else are met
// anywhere that has no list of its own. No Obsidian here, so it can be tested on its own.

import type { Terrain } from './hex';

export type Land = Exclude<Terrain, 'water'>;
export type Tables = Partial<Record<Land | 'any', string[]>>;

const NAMES: Record<string, Land> = {
	plains: 'plains', plain: 'plains', grassland: 'plains', grasslands: 'plains', steppe: 'plains', farmland: 'plains',
	forest: 'forest', forests: 'forest', woods: 'forest', wood: 'forest', woodland: 'forest',
	hills: 'hills', hill: 'hills', highlands: 'hills',
	mountains: 'mountains', mountain: 'mountains', peaks: 'mountains',
	swamp: 'swamp', swamps: 'swamp', marsh: 'swamp', marshes: 'swamp', bog: 'swamp', fen: 'swamp', wetlands: 'swamp',
};

/** The terrain a heading names, if it names one: "Forest", "Woods encounters", "In the hills (d6)". */
export function headingLand(text: string): Land | null {
	for (const w of text.toLowerCase().split(/[^a-z]+/)) if (w && NAMES[w]) return NAMES[w];
	return null;
}

/** The lists in a note, by terrain. Front matter, task boxes and a trailing full stop are dropped. */
export function parseTables(note: string): Tables {
	const out: Tables = {};
	let lines = note.split('\n');
	if (lines[0]?.trim() === '---') {
		const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
		if (end > 0) lines = lines.slice(end + 1);
	}
	let under: Land | 'any' = 'any';
	for (const raw of lines) {
		const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(raw);
		if (h) {
			under = headingLand(h[1] as string) ?? 'any';
			continue;
		}
		const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?(.*)$/.exec(raw);
		if (!m) continue;
		const item = (m[1] as string).trim().replace(/[.!]+$/, '').trim();
		if (!item) continue;
		(out[under] ??= []).push(item);
	}
	return out;
}

/** The list to roll on in a terrain, or null to use Hexwright's own. */
export function tableFor(t: Tables | undefined, land: Land): string[] | null {
	const list = t?.[land]?.length ? t[land] : t?.any;
	return list?.length ? list : null;
}

/** The note name in an `encounters:` line, without [[ ]], an alias or .md. */
export function linkName(val: string): string {
	return val.trim().replace(/^\[\[|\]\]$/g, '').replace(/\|.*$/, '').replace(/\.md$/i, '').trim();
}
