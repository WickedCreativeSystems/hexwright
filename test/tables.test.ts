import { describe, expect, it } from 'vitest';
import { parseBlock } from '../src/block';
import { DEFAULTS, generate, neighbours } from '../src/hex';
import { keyCrawl } from '../src/keys';
import { headingLand, linkName, parseTables, tableFor } from '../src/tables';
import { NEW_PLAY, travel, type Play } from '../src/travel';

describe('encounter tables', () => {
	it('reads lists by terrain heading, the rest for anywhere', () => {
		const t = parseTables('---\ntags: [x]\n- not this\n---\n# Road encounters\n- a tinker.\n* 2 bandits!\n## In the woods (d6)\n1. a bear\n2) [ ] a dryad\nprose line\n## Marsh\n+ will-o-wisps\n### Notes\n- a lost child');
		expect(t.any).toEqual(['a tinker', '2 bandits', 'a lost child']);
		expect(t.forest).toEqual(['a bear', 'a dryad']);
		expect(t.swamp).toEqual(['will-o-wisps']);
		expect(t.hills).toBeUndefined();
		expect(tableFor(t, 'forest')).toEqual(['a bear', 'a dryad']);
		expect(tableFor(t, 'hills')).toEqual(t.any);
		expect(tableFor({ forest: ['x'] }, 'hills')).toBeNull();
		expect(tableFor(undefined, 'hills')).toBeNull();
		expect(headingLand('Mountain passes')).toBe('mountains');
		expect(headingLand('Random stuff')).toBeNull();
	});
	it('takes the note name from the block, with or without brackets', () => {
		expect(linkName('[[Tables/Wilds|wilds]]')).toBe('Tables/Wilds');
		expect(linkName('Wild encounters.md')).toBe('Wild encounters');
		const p = parseBlock('seed: s\nencounters: [[Wild encounters]]');
		expect(p.problems).toEqual([]);
		expect(p.encounters).toBe('Wild encounters');
		expect(parseBlock('seed: s').encounters).toBe('');
	});
	it('meets only things from your table, and rolls the same moves', () => {
		const c = generate({ ...DEFAULTS, seed: 'saltmarch' });
		const keys = keyCrawl(c);
		const mine = ['a talking crow', 'a broken bridge'];
		let met = 0;
		// Walk many first moves from many days so some of them meet something.
		for (let day = 0; day < 60; day++) {
			const play: Play = { ...NEW_PLAY, day, visited: [] };
			const s = c.hexes[c.start]!;
			for (const [x, y] of neighbours(c, s.col, s.row)) {
				const to = y * c.cols + x;
				const own = travel(c, keys, play, to);
				const withT = travel(c, keys, play, to, { any: mine });
				if (!own) continue;
				expect(withT!.ended).toBe(own.ended);
				expect(withT!.weather).toBe(own.weather);
				expect(withT!.met === null).toBe(own.met === null);
				if (withT!.met) {
					met++;
					expect(mine).toContain(withT!.met);
					expect(withT!.line).toContain(`On the way: ${withT!.met}.`);
				}
			}
		}
		expect(met).toBeGreaterThan(10);
	});
});
