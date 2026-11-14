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

import { applyMove, canTravel, partyHex, seenSet, travel, writePlay, NEW_PLAY } from '../src/travel';

describe('travel', () => {
	const c = generate({ ...DEFAULTS, seed: 'saltmarch' });
	const keys = keyCrawl(c);
	const start = c.hexes[c.start]!;
	const land = neighbours(c, start.col, start.row).map(([x, y]) => y * c.cols + x).filter((i) => c.hexes[i]!.terrain !== 'water');

	it('reads the play lines from the block', () => {
		const { play, problems } = parseBlock('seed: saltmarch\nfog: on\nat: 0909\nday: 3\nvisited: 0808 0909');
		expect(problems).toEqual([]);
		expect(play).toEqual({ fog: true, at: '0909', day: 3, visited: ['0808', '0909'] });
		expect(parseBlock('fog: maybe\nday: x').problems).toHaveLength(2);
	});
	it('starts at the start, sees around it, and only walks to land next door', () => {
		expect(partyHex(c, NEW_PLAY)).toBe(c.start);
		const seen = seenSet(c, NEW_PLAY);
		expect(seen.has(c.start)).toBe(true);
		for (const i of land) expect(seen.has(i)).toBe(true);
		expect(seen.size).toBeLessThan(c.hexes.length / 2);
		for (const i of land) expect(canTravel(c, NEW_PLAY, i)).toBe(true);
		expect(canTravel(c, NEW_PLAY, c.start)).toBe(false);
		const far = c.hexes.find((h) => h.terrain !== 'water' && Math.abs(h.col - start.col) > 2)!;
		expect(canTravel(c, NEW_PLAY, far.i)).toBe(false);
	});
	it('moves the party, counts days, records the visit and writes a line', () => {
		const m = travel(c, keys, NEW_PLAY, land[0]!)!;
		expect(m).not.toBeNull();
		expect(m.play.day).toBe(m.days);
		expect(m.play.at).toBe(c.hexes[m.ended]!.id);
		expect(m.play.visited).toEqual([start.id, c.hexes[m.ended]!.id]);
		expect(m.line).toMatch(/^- Days? 1/);
		expect(m.line).toContain(`${start.id} to ${c.hexes[m.ended]!.id}`);
		expect(travel(c, keys, NEW_PLAY, land[0]!)).toEqual(m);
	});
	it('gets lost sometimes in the woods, never off a road', () => {
		let lost = 0, moves = 0;
		for (const seed of seeds) {
			const cc = generate({ ...DEFAULTS, seed, lean: 'forest' });
			const kk = keyCrawl(cc);
			let play = { ...NEW_PLAY };
			for (let n = 0; n < 30; n++) {
				const here = cc.hexes[partyHex(cc, play)]!;
				const opts = neighbours(cc, here.col, here.row).map(([x, y]) => y * cc.cols + x).filter((i) => canTravel(cc, play, i));
				const to = opts[n % opts.length]!;
				const m = travel(cc, kk, play, to)!;
				moves++;
				if (m.lost) {
					lost++;
					expect(here.road && cc.hexes[to]!.road).toBeFalsy();
				}
				expect(cc.hexes[m.ended]!.terrain).not.toBe('water');
				play = m.play;
			}
		}
		expect(lost).toBeGreaterThan(0);
		expect(lost).toBeLessThan(moves / 2);
	});
	it('writes the state back into the block and the day under it', () => {
		const src = 'seed: saltmarch\nfog: on\nat: 0101\nday: 9';
		const play = { fog: true, at: '0909', day: 4, visited: ['0808', '0909'] };
		expect(writePlay(src, play)).toBe('seed: saltmarch\nfog: on\nat: 0909\nday: 4\nvisited: 0808 0909');
		const note = '# Trip\n\n```hexwright\nseed: saltmarch\n```\n\nMore text.';
		const one = applyMove(note, 2, 4, play, '- Day 1: a')!;
		expect(one).toBe('# Trip\n\n```hexwright\nseed: saltmarch\nat: 0909\nday: 4\nvisited: 0808 0909\n```\n\n- Day 1: a\n\nMore text.');
		const two = applyMove(one, 2, 7, play, '- Day 2: b')!;
		expect(two).toContain('- Day 1: a\n- Day 2: b\n\nMore text.');
		expect(applyMove(note, 1, 4, play, 'x')).toBeNull();
	});
});
