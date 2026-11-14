import { describe, expect, it } from 'vitest';
import { parseBlock } from '../src/block';
import { DEFAULTS, LEANS, generate, hexDistance, hexId, neighbours, parseId, type Crawl } from '../src/hex';
import { render, toString } from '../src/render';

const seeds = ['saltmarch', 'ashfen7', 'greywold', 'ironreach', 'a', 'b', 'c', 'd', 'e', 'f'];
const adjacent = (c: Crawl, a: number, b: number) => {
	const h = c.hexes[a]!;
	return neighbours(c, h.col, h.row).some(([x, y]) => y * c.cols + x === b);
};

describe('hex grid', () => {
	it('numbers hexes column then row from 01', () => {
		expect(hexId(0, 0)).toBe('0101');
		expect(hexId(5, 6)).toBe('0607');
		expect(parseId('0607')).toEqual([5, 6]);
		expect(parseId('x1')).toBeNull();
	});
	it('gives six neighbours inside, each one hex away, and back again', () => {
		const g = { cols: 10, rows: 10 };
		for (const [c, r] of [[4, 4], [5, 4]] as [number, number][]) {
			const n = neighbours(g, c, r);
			expect(n).toHaveLength(6);
			for (const m of n) {
				expect(hexDistance([c, r], m)).toBe(1);
				expect(neighbours(g, m[0], m[1]).some(([x, y]) => x === c && y === r)).toBe(true);
			}
		}
		expect(neighbours(g, 0, 0).length).toBeLessThan(6);
	});
});

describe('generate', () => {
	it('is the same for the same seed', () => {
		expect(toString(render(generate({ ...DEFAULTS, seed: 'saltmarch' })))).toBe(toString(render(generate({ ...DEFAULTS, seed: 'saltmarch' }))));
	});
	for (const lean of LEANS)
		it(`makes a playable ${lean} map for many seeds`, () => {
			for (const seed of seeds) {
				const c = generate({ ...DEFAULTS, seed, lean });
				expect(c.hexes).toHaveLength(c.cols * c.rows);
				const land = c.hexes.filter((h) => h.terrain !== 'water');
				expect(land.length).toBeGreaterThanOrEqual(c.hexes.length * 0.55);
				expect(c.towns.length).toBeGreaterThanOrEqual(2);
				for (const t of c.towns) expect(c.hexes[t]!.terrain).not.toBe('water');
				for (const run of [...c.rivers, ...c.roads]) for (let k = 1; k < run.length; k++) expect(adjacent(c, run[k - 1]!, run[k]!)).toBe(true);
				for (const road of c.roads) for (const i of road) expect(c.hexes[i]!.terrain).not.toBe('water');
				expect(c.hexes[c.start]).toBeDefined();
			}
		});
	it('starts the party where the block says', () => {
		const c = generate({ ...DEFAULTS, seed: 'x', start: '0304' });
		expect(c.hexes[c.start]!.id).toBe('0304');
	});
	it('starts in a town otherwise', () => {
		const c = generate({ ...DEFAULTS, seed: 'x' });
		expect(c.towns).toContain(c.start);
	});
	it('has rivers on most maps', () => {
		const with_ = seeds.filter((seed) => generate({ ...DEFAULTS, seed }).rivers.length > 0).length;
		expect(with_).toBeGreaterThanOrEqual(7);
	});
});

describe('block', () => {
	it('reads size, terrain, seed and start', () => {
		const { opts, problems } = parseBlock('seed: fen\nsize: large\nterrain: swamp\nstart: 0101\n');
		expect(problems).toEqual([]);
		expect(opts).toMatchObject({ seed: 'fen', cols: 20, rows: 16, lean: 'swamp', start: '0101' });
		expect(parseBlock('size: 9x7').opts).toMatchObject({ cols: 9, rows: 7 });
	});
	it('says what it did not understand', () => {
		expect(parseBlock('terrain: lava\ncolour: red').problems).toHaveLength(2);
	});
});

describe('render', () => {
	it('draws every hex with its number', () => {
		const c = generate({ ...DEFAULTS, seed: 'saltmarch' });
		const svg = toString(render(c));
		expect(svg.match(/data-hex=/g)).toHaveLength(120);
		expect(svg).toContain('>0607<');
	});
});

import { hexNote, keyCrawl } from '../src/keys';
import { notePath } from '../src/main';

describe('keys', () => {
	it('gives every hex a key, towns their names, and rumours that point at real places', () => {
		for (const seed of seeds) {
			const c = generate({ ...DEFAULTS, seed });
			const keys = keyCrawl(c);
			expect(keys).toHaveLength(c.hexes.length);
			for (const t of c.towns) expect(keys[t]!.kind).toBe('town');
			const named = keys.filter((k) => k.kind !== 'empty').map((k) => k.name);
			expect(new Set(named).size).toBe(named.length);
			const rumours = keys.filter((k) => k.rumour);
			expect(rumours.length).toBeGreaterThan(c.hexes.length * 0.1);
			for (const k of rumours) {
				expect(keys[k.rumour!.to]!.kind).not.toBe('empty');
				expect(k.rumour!.text).toContain(c.hexes[k.rumour!.to]!.id);
			}
			expect(keys.filter((k) => k.kind !== 'empty' && k.kind !== 'town').length).toBeGreaterThan(c.hexes.length * 0.15);
		}
	});
	it('is the same for the same seed', () => {
		expect(keyCrawl(generate({ ...DEFAULTS, seed: 'q' }))).toEqual(keyCrawl(generate({ ...DEFAULTS, seed: 'q' })));
	});
	it('writes a hex note with a mapsmith block for towns and ruins', () => {
		const c = generate({ ...DEFAULTS, seed: 'saltmarch' });
		const keys = keyCrawl(c);
		const town = c.towns[0]!;
		const note = hexNote(c, keys, town);
		expect(note).toContain(`# ${c.hexes[town]!.id}: ${keys[town]!.name}`);
		expect(note).toContain('```mapsmith');
		expect(note).toContain(`seed: saltmarch-${c.hexes[town]!.id}`);
		const ruin = keys.findIndex((k) => k.kind === 'ruin');
		if (ruin >= 0) expect(hexNote(c, keys, ruin)).toContain('map: dungeon');
		const empty = keys.findIndex((k) => k.kind === 'empty');
		expect(hexNote(c, keys, empty)).not.toContain('```mapsmith');
	});
	it('puts the note beside the map note', () => {
		const c = generate({ ...DEFAULTS, seed: 'saltmarch' });
		expect(notePath('Campaign/Maps/Crawl.md', c, 0)).toBe('Campaign/Maps/saltmarch 0101.md');
		expect(notePath('Crawl.md', c, 0)).toBe('saltmarch 0101.md');
	});
});

describe('key names', () => {
	it('never falls back to a bare label like "X Landmark"', () => {
		for (const seed of seeds) {
			const keys = keyCrawl(generate({ ...DEFAULTS, seed, cols: 20, rows: 16 }));
			for (const k of keys) expect(k.name).not.toMatch(/^\S+ (Landmark|Lair|Resource|tower|keep|mine|chapel)$/);
		}
	});
});
