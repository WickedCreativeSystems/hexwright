// A hex crawl from a seed: a grid of flat-topped hexes, numbered the old way (0607 is column 6, row 7),
// with terrain from noise, rivers that run downhill to the sea or off the map, and roads between towns.
// Columns are offset odd-q: every odd column (counted from 1, so 02, 04 ...) sits half a hex lower.

import { chance, fork, int, makeNoise, makeRng, pick, shuffle, type Rng } from './rng';

export type Terrain = 'plains' | 'forest' | 'hills' | 'mountains' | 'swamp' | 'water';
export const TERRAINS: Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'swamp', 'water'];

export type Lean = 'mixed' | 'forest' | 'steppe' | 'mountains' | 'swamp' | 'coast';
export const LEANS: Lean[] = ['mixed', 'forest', 'steppe', 'mountains', 'swamp', 'coast'];

export type Side = 'north' | 'south' | 'east' | 'west';

export const SIZES = { small: [8, 6], medium: [12, 10], large: [20, 16] } as const;
export type SizeName = keyof typeof SIZES;

export interface CrawlOptions {
	seed: string;
	cols: number;
	rows: number;
	lean: Lean;
	/** the party's hex, as "0607"; empty means the town nearest the middle */
	start: string;
}

export const DEFAULTS: CrawlOptions = { seed: 'hexwright', cols: 12, rows: 10, lean: 'mixed', start: '' };

export interface Hex {
	i: number; // index into Crawl.hexes, row-major
	col: number; // from 0
	row: number; // from 0
	id: string; // "0607", 1-based column then row
	terrain: Terrain;
	elev: number; // 0..1
	wet: number; // 0..1
	coast: boolean; // land beside the sea
	river: boolean;
	road: boolean;
	town: boolean;
}

export interface Crawl {
	opts: CrawlOptions;
	cols: number;
	rows: number;
	hexes: Hex[];
	sea: Side | null;
	rivers: number[][]; // each a run of hex indices, source first; the last may lead off the map
	roads: number[][]; // each a run of hex indices from town to town
	towns: number[];
	start: number;
}

export const hexId = (col: number, row: number) => String(col + 1).padStart(2, '0') + String(row + 1).padStart(2, '0');

/** "0607" -> [5, 6]; wider maps use three digits a side ("012003"). */
export function parseId(id: string): [number, number] | null {
	const s = id.trim();
	if (!/^\d+$/.test(s) || s.length % 2) return null;
	const h = s.length / 2;
	const c = Number(s.slice(0, h)) - 1, r = Number(s.slice(h)) - 1;
	return c >= 0 && r >= 0 ? [c, r] : null;
}

// Neighbour steps for odd-q offset columns. Index 0 is north, then clockwise.
const EVEN: [number, number][] = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]];
const ODD: [number, number][] = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

export function neighbours(c: Crawl | { cols: number; rows: number }, col: number, row: number): [number, number][] {
	// col is 0-based: col 1 (printed 02) and every other one after it sits half a hex lower
	const steps = col % 2 === 1 ? ODD : EVEN;
	const out: [number, number][] = [];
	for (const [dc, dr] of steps) {
		const nc = col + dc, nr = row + dr;
		if (nc >= 0 && nr >= 0 && nc < c.cols && nr < c.rows) out.push([nc, nr]);
	}
	return out;
}

/** Hex distance on odd-q offset coordinates. */
export function hexDistance(a: [number, number], b: [number, number]): number {
	const cube = ([col, row]: [number, number]) => {
		const x = col, z = row - (col - (col & 1)) / 2;
		return [x, -x - z, z];
	};
	const [ax, ay, az] = cube(a), [bx, by, bz] = cube(b);
	return Math.max(Math.abs(ax! - bx!), Math.abs(ay! - by!), Math.abs(az! - bz!));
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

interface LeanShape {
	sea: number; // chance of a sea along one side
	seaLevel: number;
	rough: number; // how much the high ground stands out
	// shares of the land, highest ground first, then the wettest of what's left
	mountains: number;
	hills: number;
	forest: number;
	swamp: number;
}
const LEAN: Record<Lean, LeanShape> = {
	mixed: { sea: 0.5, seaLevel: 0.2, rough: 1, mountains: 0.1, hills: 0.17, forest: 0.32, swamp: 0.07 },
	forest: { sea: 0.25, seaLevel: 0.18, rough: 0.8, mountains: 0.05, hills: 0.13, forest: 0.6, swamp: 0.08 },
	steppe: { sea: 0.15, seaLevel: 0.16, rough: 0.7, mountains: 0.04, hills: 0.14, forest: 0.08, swamp: 0.03 },
	mountains: { sea: 0.2, seaLevel: 0.15, rough: 1.35, mountains: 0.3, hills: 0.25, forest: 0.3, swamp: 0.03 },
	swamp: { sea: 0.4, seaLevel: 0.2, rough: 0.6, mountains: 0.03, hills: 0.09, forest: 0.25, swamp: 0.38 },
	coast: { sea: 1, seaLevel: 0.26, rough: 0.9, mountains: 0.08, hills: 0.15, forest: 0.28, swamp: 0.08 },
};

// Land by rank, not by fixed heights, so every seed gives about the mix its lean promises.
function classify(land: Hex[], shape: LeanShape) {
	const byHeight = [...land].sort((a, b) => b.elev - a.elev);
	const nm = Math.round(land.length * shape.mountains), nh = Math.round(land.length * shape.hills);
	byHeight.forEach((h, k) => (h.terrain = k < nm ? 'mountains' : k < nm + nh ? 'hills' : 'plains'));
	const low = byHeight.slice(nm + nh);
	const ns = Math.round(land.length * shape.swamp);
	[...low].sort((a, b) => b.wet - b.elev * 0.8 - (a.wet - a.elev * 0.8)).slice(0, ns).forEach((h) => (h.terrain = 'swamp'));
	const nf = Math.round(land.length * shape.forest);
	low.filter((h) => h.terrain === 'plains').sort((a, b) => b.wet - a.wet).slice(0, nf).forEach((h) => (h.terrain = 'forest'));
}

export function generate(opts: CrawlOptions): Crawl {
	const r = makeRng(opts.seed);
	const cols = Math.max(4, Math.min(40, Math.round(opts.cols)));
	const rows = Math.max(4, Math.min(40, Math.round(opts.rows)));
	const shape = LEAN[opts.lean];
	const height = makeNoise(fork(r, 'height'));
	const water = makeNoise(fork(r, 'wet'));
	const sr = fork(r, 'sea');
	const sea: Side | null = chance(sr, shape.sea) ? pick(sr, ['north', 'south', 'east', 'west'] as Side[]) : null;
	const scale = 4.2 / Math.max(cols, rows) ** 0.85; // noise cells across the map: about 4 whatever the size

	const hexes: Hex[] = [];
	for (let row = 0; row < rows; row++)
		for (let col = 0; col < cols; col++) {
			const x = col * 0.866, y = row + (col % 2) * 0.5; // centres in row units
			const u = col / (cols - 1), v = row / (rows - 1); // 0..1 across
			let elev = (height(x * scale + 3.1, y * scale + 7.7) - 0.5) * 1.7 * shape.rough + 0.5;
			// the sea side falls away; the far side climbs a little
			if (sea) {
				const d = sea === 'north' ? v : sea === 'south' ? 1 - v : sea === 'west' ? u : 1 - u;
				elev += (d - 0.35) * 0.55;
				if (d < 0.08) elev -= 0.25;
			}
			let wet = (water(x * scale * 1.3 + 11, y * scale * 1.3 + 2) - 0.5) * 1.8 + 0.5;
			elev = clamp(elev);
			wet = clamp(wet);
			hexes.push({ i: hexes.length, col, row, id: hexId(col, row), terrain: elev < shape.seaLevel ? 'water' : 'plains', elev, wet, coast: false, river: false, road: false, town: false });
		}
	const at = (col: number, row: number) => hexes[row * cols + col] as Hex;
	const near = (h: Hex) => neighbours({ cols, rows }, h.col, h.row).map(([c, w]) => at(c, w));

	// Without a sea side, only the lowest hollows hold water (lakes); and most of the map is always land.
	if (!sea) for (const h of hexes) if (h.terrain === 'water' && h.elev > shape.seaLevel - 0.08) h.terrain = 'plains';
	const minLand = Math.ceil(hexes.length * 0.6);
	if (hexes.filter((h) => h.terrain !== 'water').length < minLand)
		for (const h of [...hexes].sort((a, b) => b.elev - a.elev).slice(0, minLand)) h.terrain = 'plains';
	const land = hexes.filter((h) => h.terrain !== 'water');
	classify(land, shape);
	for (const h of hexes) if (h.terrain !== 'water') h.coast = near(h).some((n) => n.terrain === 'water');

	// Rivers: from high ground, always to the lowest neighbour not yet taken, until the sea, a river or the edge.
	const rr = fork(r, 'rivers');
	const rivers: number[][] = [];
	const wantRivers = Math.max(1, Math.round((cols * rows) / 70)) + (opts.lean === 'steppe' ? -1 : 0) + (opts.lean === 'swamp' || opts.lean === 'forest' ? 1 : 0);
	const sources = shuffle(rr, hexes.filter((h) => h.terrain === 'mountains' || h.terrain === 'hills'));
	if (!sources.length) sources.push(...shuffle(rr, [...land]).sort((a, b) => b.elev - a.elev).slice(0, 3));
	for (const src of sources) {
		if (rivers.length >= wantRivers) break;
		if (src.river || near(src).some((n) => n.river)) continue;
		const run = [src.i];
		const taken = new Set(run);
		let cur = src;
		for (let step = 0; step < cols * rows; step++) {
			const onEdge = cur.col === 0 || cur.row === 0 || cur.col === cols - 1 || cur.row === rows - 1;
			const next = near(cur)
				.filter((n) => !taken.has(n.i))
				.sort((a, b) => a.elev - b.elev)[0];
			if (!next) break;
			if (onEdge && next.elev >= cur.elev) break; // runs off the map
			run.push(next.i);
			taken.add(next.i);
			if (next.terrain === 'water' || next.river) break;
			cur = next;
		}
		const last = hexes[run[run.length - 1] as number] as Hex;
		const ends = last.terrain === 'water' || last.river || last.col === 0 || last.row === 0 || last.col === cols - 1 || last.row === rows - 1;
		if (run.length < 3 || !ends) continue;
		for (const i of run) {
			const h = hexes[i] as Hex;
			if (h.terrain !== 'water') h.river = true;
			if (h.terrain === 'mountains' && h !== src) h.terrain = 'hills'; // a river cuts a valley
		}
		rivers.push(run);
	}

	// Towns: on good land, best by a river or the coast, kept apart.
	const tr = fork(r, 'towns');
	const wantTowns = Math.max(2, Math.round((cols * rows) / 30));
	const spots = shuffle(tr, land.filter((h) => h.terrain === 'plains' || h.terrain === 'forest' || h.terrain === 'hills'))
		.map((h) => ({ h, score: (h.river ? 2 : 0) + (h.coast ? 1.5 : 0) + (h.terrain === 'plains' ? 1 : 0) + tr() * 1.5 }))
		.sort((a, b) => b.score - a.score);
	const towns: number[] = [];
	const gap = Math.max(3, Math.round(Math.sqrt((cols * rows) / wantTowns) * 0.9));
	for (const { h } of spots) {
		if (towns.length >= wantTowns) break;
		if (towns.some((t) => hexDistance([h.col, h.row], [(hexes[t] as Hex).col, (hexes[t] as Hex).row]) < gap)) continue;
		h.town = true;
		towns.push(h.i);
	}

	// Roads: join the towns along the cheapest ground (a tree, nearest first), never through water.
	const cost: Record<Terrain, number> = { plains: 1, forest: 2.2, hills: 2.6, mountains: 6, swamp: 4, water: Infinity };
	const step = (h: Hex) => cost[h.terrain] - (h.road ? 0.6 : 0);
	const roads: number[][] = [];
	const joined = towns.slice(0, 1);
	const left = towns.slice(1);
	while (left.length) {
		let best: number[] | null = null, bestCost = Infinity, bestK = -1;
		for (let k = 0; k < left.length; k++) {
			const found = cheapest(hexes, cols, rows, joined, left[k] as number, step);
			if (found && found.cost < bestCost) {
				best = found.path;
				bestCost = found.cost;
				bestK = k;
			}
		}
		if (!best) break; // the rest are cut off by water
		roads.push(best);
		for (const i of best) (hexes[i] as Hex).road = true;
		joined.push(left.splice(bestK, 1)[0] as number);
	}

	// The party starts at the asked hex, or the town nearest the middle.
	const mid: [number, number] = [Math.floor(cols / 2), Math.floor(rows / 2)];
	let start = -1;
	const asked = parseId(opts.start);
	if (asked && asked[0] < cols && asked[1] < rows) start = asked[1] * cols + asked[0];
	if (start < 0) start = [...towns].sort((a, b) => hexDistance([(hexes[a] as Hex).col, (hexes[a] as Hex).row], mid) - hexDistance([(hexes[b] as Hex).col, (hexes[b] as Hex).row], mid))[0] ?? land[0]?.i ?? 0;

	return { opts: { ...opts, cols, rows }, cols, rows, hexes, sea, rivers, roads, towns, start };
}

// Dijkstra from any hex in `from` to `to`; returns the path from a `from` hex to `to`.
function cheapest(hexes: Hex[], cols: number, rows: number, from: number[], to: number, step: (h: Hex) => number): { path: number[]; cost: number } | null {
	const dist = new Float64Array(hexes.length).fill(Infinity);
	const prev = new Int32Array(hexes.length).fill(-1);
	const open = new Set<number>();
	for (const f of from) {
		dist[f] = 0;
		open.add(f);
	}
	while (open.size) {
		let u = -1, du = Infinity;
		for (const k of open) if ((dist[k] as number) < du) { u = k; du = dist[k] as number; }
		open.delete(u);
		if (u === to) break;
		const h = hexes[u] as Hex;
		for (const [c, w] of neighbours({ cols, rows }, h.col, h.row)) {
			const v = w * cols + c;
			const s = step(hexes[v] as Hex);
			if (!Number.isFinite(s)) continue;
			const d = du + Math.max(0.2, s);
			if (d < (dist[v] as number)) {
				dist[v] = d;
				prev[v] = u;
				open.add(v);
			}
		}
	}
	if (!Number.isFinite(dist[to])) return null;
	const path = [to];
	while ((prev[path[path.length - 1] as number] as number) >= 0) path.push(prev[path[path.length - 1] as number] as number);
	return { path: path.reverse(), cost: dist[to] as number };
}

/** A seed word for a new block, so each inserted map differs. */
export function newSeed(r: Rng = Math.random): string {
	const a = ['salt', 'ash', 'thorn', 'grey', 'wolf', 'reed', 'iron', 'mist', 'barrow', 'cold', 'raven', 'amber'];
	const b = ['march', 'moor', 'fen', 'wold', 'reach', 'down', 'holt', 'dale', 'mere', 'heath', 'shire', 'vale'];
	return pick(r, a) + pick(r, b) + int(r, 1, 99);
}
