// The crawl as SVG: a small tree of nodes that can become a string (for export and tests) or real DOM.

import type { Crawl, Hex, Terrain } from './hex';
import type { Key } from './keys';
import { makeRng, range, type Rng } from './rng';

export interface Node {
	tag: string;
	a: Record<string, string | number>;
	kids?: (Node | string)[];
}

export const el = (tag: string, a: Record<string, string | number>, kids?: (Node | string)[]): Node => (kids ? { tag, a, kids } : { tag, a });

export interface Palette {
	paper: string;
	grid: string;
	ink: string;
	label: string;
	fill: Record<Terrain, string>;
	mark: Record<Terrain, string>;
	river: string;
	road: string;
	town: string;
	party: string;
	fog: string;
}

export const LIGHT: Palette = {
	paper: '#efe7d2',
	grid: '#8d8166',
	ink: '#3b3427',
	label: '#6b604a',
	fill: { plains: '#e6dcb4', forest: '#c3cf9a', hills: '#ddcb9c', mountains: '#cdbfa6', swamp: '#bfc9a8', water: '#9fbfc4' },
	mark: { plains: '#b3a676', forest: '#5f7a3c', hills: '#8a7448', mountains: '#5e5243', swamp: '#5d7356', water: '#567f86' },
	river: '#4f8199',
	road: '#8b5a2b',
	town: '#7a2e22',
	party: '#b8322a',
	fog: '#d9d3c3',
};

const SQ3 = Math.sqrt(3);
export const HEX = 30; // centre to corner, in SVG units

export function centre(h: { col: number; row: number }): [number, number] {
	return [HEX + h.col * 1.5 * HEX, (SQ3 / 2) * HEX * (1 + 2 * h.row + (h.col % 2))];
}

export function size(c: Crawl): [number, number] {
	return [HEX * (2 + 1.5 * (c.cols - 1)), (SQ3 / 2) * HEX * (2 * c.rows + 1)];
}

const f = (n: number) => Math.round(n * 10) / 10;

function corners(x: number, y: number, s = HEX): string {
	const pts: string[] = [];
	for (let k = 0; k < 6; k++) {
		const a = (Math.PI / 3) * k;
		pts.push(`${f(x + s * Math.cos(a))},${f(y + s * Math.sin(a))}`);
	}
	return pts.join(' ');
}

// One small drawing per terrain, scattered inside the hex but clear of its number.
function marks(h: Hex, r: Rng, p: Palette): Node[] {
	const [x, y] = centre(h);
	const ink = p.mark[h.terrain];
	const out: Node[] = [];
	const spots = (n: number, spread: number): [number, number][] => {
		const s: [number, number][] = [];
		for (let k = 0; k < n; k++) s.push([x + range(r, -spread, spread), y + range(r, -spread * 0.55, spread * 0.75)]);
		return s.sort((a, b) => a[1] - b[1]);
	};
	switch (h.terrain) {
		case 'forest':
			for (const [tx, ty] of spots(4, 11)) {
				out.push(el('path', { d: `M${f(tx)},${f(ty - 7)} l4.5,8 h-9 z`, fill: ink, opacity: 0.85 }));
				out.push(el('line', { x1: f(tx), y1: f(ty + 1), x2: f(tx), y2: f(ty + 3.5), stroke: ink, 'stroke-width': 1.2 }));
			}
			break;
		case 'hills':
			for (const [tx, ty] of spots(2, 9)) out.push(el('path', { d: `M${f(tx - 8)},${f(ty + 3)} q8,-11 16,0`, fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
			break;
		case 'mountains': {
			const peaks: [number, number, number][] = [[x - 7, y + 6, 9], [x + 5, y + 6, 12]];
			for (const [px, py, ht] of peaks) {
				out.push(el('path', { d: `M${f(px - ht * 0.8)},${f(py)} L${f(px)},${f(py - ht * 1.3)} L${f(px + ht * 0.8)},${f(py)} z`, fill: p.fill.mountains, stroke: ink, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
				out.push(el('path', { d: `M${f(px)},${f(py - ht * 1.3)} L${f(px + ht * 0.8)},${f(py)} L${f(px + ht * 0.2)},${f(py)} z`, fill: ink, opacity: 0.3 }));
			}
			break;
		}
		case 'swamp':
			for (const [tx, ty] of spots(3, 10)) {
				out.push(el('line', { x1: f(tx - 5), y1: f(ty + 3), x2: f(tx + 5), y2: f(ty + 3), stroke: ink, 'stroke-width': 1.2 }));
				out.push(el('path', { d: `M${f(tx - 2.5)},${f(ty + 2)} l-1,-4 M${f(tx)},${f(ty + 2)} v-5 M${f(tx + 2.5)},${f(ty + 2)} l1,-4`, stroke: ink, 'stroke-width': 1, fill: 'none' }));
			}
			break;
		case 'water':
			for (const [tx, ty] of spots(2, 9)) out.push(el('path', { d: `M${f(tx - 6)},${f(ty)} q3,-3 6,0 t6,0`, fill: 'none', stroke: ink, 'stroke-width': 1.1, opacity: 0.8 }));
			break;
		case 'plains':
			for (const [tx, ty] of spots(2, 11)) out.push(el('path', { d: `M${f(tx - 2)},${f(ty)} l2,-3 l2,3`, fill: 'none', stroke: ink, 'stroke-width': 1 }));
			break;
	}
	return out;
}

// A line through hex centres, rounded at the turns.
// The wobble is the hex's own, so two roads through the same hexes draw as one.
function through(c: Crawl, run: number[], label: string, wobble: number): string {
	const pts = run.map((i) => {
		const [x, y] = centre(c.hexes[i] as Hex);
		const r = makeRng(`${c.opts.seed}:${label}:${i}`);
		return [x + range(r, -wobble, wobble), y + range(r, -wobble, wobble)] as [number, number];
	});
	if (pts.length < 2) return '';
	let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`;
	for (let k = 1; k < pts.length - 1; k++) {
		const [ax, ay] = pts[k]!, [bx, by] = pts[k + 1]!;
		d += ` Q${f(ax)},${f(ay)} ${f((ax + bx) / 2)},${f((ay + by) / 2)}`;
	}
	const [lx, ly] = pts[pts.length - 1]!;
	return d + ` L${f(lx)},${f(ly)}`;
}

export interface RenderOpts {
	palette?: Palette;
	numbers?: boolean;
	keys?: Key[];
	/** the hex picked, outlined */
	picked?: number;
	/** the party's hex; default the crawl's start */
	at?: number;
	/** when given, hexes not in it are drawn as fog */
	seen?: Set<number>;
}

// The mark for what is in a hex (towns are drawn apart, bigger).
function glyph(k: Key, x: number, y: number, p: Palette): Node | null {
	const ink = p.ink, s = { stroke: ink, 'stroke-width': 1.2, 'stroke-linejoin': 'round' } as const;
	switch (k.kind) {
		case 'village':
			return el('path', { d: `M${f(x - 4.5)},${f(y + 5)} v-5 l4.5,-4.5 l4.5,4.5 v5 z`, fill: p.town, ...s });
		case 'ruin':
			return el('path', { d: `M${f(x - 5)},${f(y + 6)} v-10 h2 v2 h2 v-2 h2 v4 l2,-2 v8 z`, fill: '#a99c86', ...s });
		case 'lair':
			return el('path', { d: `M${f(x - 7)},${f(y + 5)} q7,-14 14,0 z M${f(x - 2.5)},${f(y + 5)} q2.5,-6 5,0`, fill: '#6d5a48', ...s });
		case 'landmark':
			return el('path', { d: `M${f(x - 2.5)},${f(y + 6)} l1,-12 h3 l1,12 z`, fill: '#b7ad98', ...s });
		case 'resource':
			return el('path', { d: `M${f(x)},${f(y - 6)} l5,6 l-5,6 l-5,-6 z`, fill: '#d9b343', ...s });
		default:
			return null;
	}
}

export function render(c: Crawl, o: RenderOpts = {}): Node {
	const p = o.palette ?? LIGHT;
	const [w, h] = size(c);
	const tiles: Node[] = [], art: Node[] = [], labels: Node[] = [];
	for (const hx of c.hexes) {
		const [x, y] = centre(hx);
		tiles.push(el('polygon', { points: corners(x, y), fill: p.fill[hx.terrain], 'data-hex': hx.id, class: 'hexwright-hex' }));
		const k = o.keys?.[hx.i];
		const g = k ? glyph(k, x, y + 2, p) : null;
		if (g) art.push(g);
		else if (!hx.town) art.push(...marks(hx, makeRng(c.opts.seed + ':' + hx.id), p));
		if (o.numbers !== false) labels.push(el('text', { x: f(x), y: f(y - HEX * 0.6), 'font-size': 7.5, 'text-anchor': 'middle', fill: p.label, 'font-family': 'sans-serif' }, [hx.id]));
	}
	const rivers = c.rivers.map((run) => el('path', { d: through(c, run, 'river', 4), fill: 'none', stroke: p.river, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
	const roads = c.roads.map((run) => el('path', { d: through(c, run, 'road', 3), fill: 'none', stroke: p.road, 'stroke-width': 1.8, 'stroke-dasharray': '5 3', 'stroke-linecap': 'round' }));
	const towns = c.towns.map((i) => {
		const [x, y] = centre(c.hexes[i] as Hex);
		return el('g', { class: 'hexwright-town' }, [
			el('rect', { x: f(x - 6), y: f(y - 3), width: 12, height: 9, fill: p.town, stroke: p.ink, 'stroke-width': 0.8 }),
			el('path', { d: `M${f(x - 7.5)},${f(y - 2.5)} L${f(x)},${f(y - 9)} L${f(x + 7.5)},${f(y - 2.5)} z`, fill: p.town, stroke: p.ink, 'stroke-width': 0.8 }),
		]);
	});
	const s = (c.hexes[o.at ?? c.start] ?? c.hexes[c.start]) as Hex;
	const [sx, sy] = centre(s);
	const party = el('g', { class: 'hexwright-party', 'pointer-events': 'none' }, [
		el('polygon', { points: corners(sx, sy, HEX - 2.5), fill: 'none', stroke: p.party, 'stroke-width': 2.5 }),
		el('circle', { cx: f(sx), cy: f(sy + HEX * 0.48), r: 3.5, fill: p.party }),
	]);
	const pick = o.picked !== undefined && c.hexes[o.picked] ? [el('polygon', { points: corners(...centre(c.hexes[o.picked] as Hex), HEX - 1.5), fill: 'none', stroke: p.ink, 'stroke-width': 2, 'stroke-dasharray': '4 2', class: 'hexwright-picked', 'pointer-events': 'none' })] : [];
	const fog = o.seen ? c.hexes.filter((hx) => !o.seen!.has(hx.i)).map((hx) => el('polygon', { points: corners(...centre(hx)), fill: p.fog })) : [];
	const grid = el('g', { 'pointer-events': 'none', fill: 'none', stroke: p.grid, 'stroke-width': 0.8, opacity: 0.7 }, c.hexes.map((hx) => el('polygon', { points: corners(...centre(hx)) })));
	return el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${f(w)} ${f(h)}`, width: f(w), height: f(h), class: 'hexwright-map' }, [
		el('rect', { x: 0, y: 0, width: f(w), height: f(h), fill: p.paper }),
		el('g', {}, tiles),
		el('g', { 'pointer-events': 'none' }, art),
		el('g', { 'pointer-events': 'none' }, rivers),
		el('g', { 'pointer-events': 'none' }, roads),
		el('g', { 'pointer-events': 'none' }, towns),
		el('g', { 'pointer-events': 'none', class: 'hexwright-fog' }, fog),
		grid,
		party,
		...pick,
		el('g', { 'pointer-events': 'none' }, labels),
	]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toString(n: Node | string): string {
	if (typeof n === 'string') return esc(n);
	const attrs = Object.entries(n.a)
		.map(([k, v]) => ` ${k}="${esc(String(v))}"`)
		.join('');
	if (!n.kids?.length) return `<${n.tag}${attrs}/>`;
	return `<${n.tag}${attrs}>${n.kids.map(toString).join('')}</${n.tag}>`;
}

// Build the tree under `parent` with Obsidian's own element helpers.
export function toDom(n: Node, parent: Element): SVGElement {
	const attr: Record<string, string> = {};
	for (const [k, v] of Object.entries(n.a)) if (k !== 'xmlns') attr[k] = String(v);
	const e = parent.createSvg(n.tag as keyof SVGElementTagNameMap, { attr });
	for (const k of n.kids ?? []) {
		if (typeof k === 'string') e.appendText(k);
		else toDom(k, e);
	}
	return e;
}
