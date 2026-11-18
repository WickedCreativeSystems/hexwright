// Play: where the party is, what it has seen, and a day's travel from one hex to the next. The state lives in
// the block as plain lines (`at:`, `day:`, `visited:`), so the note is the save. No Obsidian here, so it can be
// tested on its own.

import { hexDistance, neighbours, parseId, type Crawl, type Hex, type Terrain } from './hex';
import type { Key } from './keys';
import { tableFor, type Tables } from './tables';
import { chance, makeRng, pick, type Rng } from './rng';

export interface Play {
	/** hide hexes the party hasn't seen */
	fog: boolean;
	/** the party's hex, as "0607"; empty means where the crawl starts */
	at: string;
	/** days spent so far */
	day: number;
	/** hexes the party has been in, in order of first visit */
	visited: string[];
	/** days of food the party carries; undefined when the block doesn't track it */
	rations?: number;
}

export const NEW_PLAY: Play = { fog: false, at: '', day: 0, visited: [] };

export function indexOf(c: Crawl, id: string): number {
	const p = parseId(id);
	if (!p) return -1;
	const [col, row] = p;
	return col >= 0 && col < c.cols && row >= 0 && row < c.rows ? row * c.cols + col : -1;
}

/** The party's hex: `at:` if it is a real land hex, else the start. */
export function partyHex(c: Crawl, play: Play): number {
	const i = indexOf(c, play.at);
	return i >= 0 && c.hexes[i]?.terrain !== 'water' ? i : c.start;
}

function near(c: Crawl, h: Hex): Hex[] {
	return neighbours(c, h.col, h.row).map(([x, y]) => c.hexes[y * c.cols + x] as Hex);
}

/** What the party has seen: every hex it has been in and the hexes around them, two deep from hills and mountains. */
export function seenSet(c: Crawl, play: Play): Set<number> {
	const seen = new Set<number>();
	const been = [...play.visited.map((id) => indexOf(c, id)).filter((i) => i >= 0), partyHex(c, play)];
	for (const i of been) {
		const h = c.hexes[i] as Hex;
		const reach = h.terrain === 'hills' || h.terrain === 'mountains' ? 2 : 1;
		for (const o of c.hexes) if (hexDistance([h.col, h.row], [o.col, o.row]) <= reach) seen.add(o.i);
	}
	return seen;
}

/** Can the party walk from its hex to hex `to` in one move? */
export function canTravel(c: Crawl, play: Play, to: number): boolean {
	const from = c.hexes[partyHex(c, play)] as Hex, h = c.hexes[to];
	if (!h || h.terrain === 'water' || h.i === from.i) return false;
	return hexDistance([from.col, from.row], [h.col, h.row]) === 1;
}

/** Days to cross into a hex: a road both ends makes any hex one day; swamp and mountains take two otherwise. */
export function daysTo(from: Hex, to: Hex): number {
	if (from.road && to.road) return 1;
	return to.terrain === 'swamp' || to.terrain === 'mountains' ? 2 : 1;
}

const LOST: Record<Terrain, number> = { plains: 0, water: 0, forest: 2 / 6, swamp: 2 / 6, hills: 1 / 6, mountains: 1 / 6 };
const DANGER: Record<Terrain, number> = { plains: 1 / 6, water: 1 / 6, forest: 2 / 6, swamp: 2 / 6, hills: 1 / 6, mountains: 2 / 6 };

/** The chance a day's foraging finds a day's food; better along a river. */
const FORAGE: Record<Terrain, number> = { plains: 1 / 6, water: 0, forest: 2 / 6, swamp: 1 / 6, hills: 1 / 6, mountains: 0 };

const WEATHER = ['Clear', 'Clear', 'Bright and cold', 'Overcast', 'Overcast', 'Wind from the west', 'Drizzle', 'Rain all day', 'Fog until noon', 'A storm in the afternoon', 'Hot and still', 'Frost at dawn'];

const MEET: Record<Exclude<Terrain, 'water'>, string[]> = {
	plains: ['a pedlar with a lame mule', 'riders who ask the party their business', 'a farmer who has lost three sheep', 'wolves following at a distance', 'a burned cart and no sign of its driver', 'pilgrims going the other way'],
	forest: ['a charcoal burner who knows the paths', 'outlaws who want a toll', 'a wounded stag, and what wounded it', 'giant spiders in the canopy', 'a woodcutter who will not say why he is running', 'a hunting party from the nearest lord'],
	hills: ['shepherds and their dogs', 'goblins watching from a ridge', 'a hermit in a cave mouth', 'a rockfall across the way', 'a patrol from the nearest fort', 'an ogre fishing in a stream'],
	mountains: ['a goat herder with news from the pass', 'a wyvern circling', 'dwarves going down to market', 'a snowfield that has to be crossed roped', 'a giant asleep across the path', 'a dead climber with a full pack'],
	swamp: ['an eel trapper in a flat boat', 'lizardfolk hunters', 'lights that move away when followed', 'a bog that takes a pack animal', 'a hag who wants to trade', 'leeches, and a fever after'],
};

export interface Move {
	play: Play;
	/** the hex the party ended in (not the one it set out for, if it got lost) */
	ended: number;
	days: number;
	lost: boolean;
	weather: string;
	met: string | null;
	/** days of food found on the way (only when rations are tracked) */
	foraged: number;
	/** the log line for the note */
	line: string;
}

/** One move into a neighbouring hex. `tables`, from your own encounter note, replaces Hexwright's list where it has one. Rolls come from the seed, the day and the hexes, so the same move rolls the same. */
export function travel(c: Crawl, keys: Key[], play: Play, to: number, tables?: Tables): Move | null {
	if (!canTravel(c, play, to)) return null;
	const from = c.hexes[partyHex(c, play)] as Hex;
	const aim = c.hexes[to] as Hex;
	const r: Rng = makeRng(`${c.opts.seed}:day${play.day}:${from.id}:${aim.id}`);
	const following = (from.road && aim.road) || (from.river && aim.river);
	let end = aim;
	let lost = false;
	if (!following && chance(r, LOST[aim.terrain])) {
		const other = near(c, from).filter((h) => h.terrain !== 'water' && h.i !== aim.i);
		if (other.length) {
			end = pick(r, other);
			lost = true;
		}
	}
	const days = daysTo(from, end);
	const weather = pick(r, WEATHER);
	const t = end.terrain === 'water' ? 'plains' : end.terrain;
	const met = chance(r, DANGER[end.terrain]) ? pick(r, tableFor(tables, t) ?? MEET[t]) : null;
	const firstTime = !play.visited.includes(end.id);
	const k = keys[end.i];
	const day = play.day + 1;
	const span = days === 1 ? `Day ${day}` : `Days ${day}–${day + days - 1}`;
	const via = from.road && end.road ? ', by road' : from.river && end.river ? ', along the river' : '';
	const parts = [lost ? `${from.id} to ${end.id}, lost on the way to ${aim.id} (${end.terrain})` : `${from.id} to ${end.id} (${end.terrain}${via})`];
	parts.push(`${weather}.`);
	if (met) parts.push(`On the way: ${met}.`);
	if (k && k.kind !== 'empty' && firstTime) parts.push(`Found ${k.name} (${k.label.toLowerCase()}).`);
	// Food has its own rolls, so tracking rations never changes the weather, the way or the meetings.
	let rations = play.rations;
	let foraged = 0;
	if (rations !== undefined) {
		const fr = makeRng(`${c.opts.seed}:day${play.day}:${from.id}:${end.id}:food`);
		const odds = FORAGE[end.terrain] + (end.river ? 1 / 6 : 0);
		for (let d = 0; d < days; d++) if (chance(fr, odds)) foraged++;
		// Hungry when what they carried plus what they found is less than the days walked.
		const hungry = rations + foraged < days;
		rations = Math.max(0, rations - days + foraged);
		if (foraged) parts.push(`Foraged ${foraged === 1 ? "a day's food" : `${foraged} days' food`}.`);
		parts.push(hungry ? 'Out of food, and hungry.' : rations === 0 ? 'No food left.' : `Food left: ${rations} ${rations === 1 ? 'day' : 'days'}.`);
	}
	const line = `- ${span}: ${parts[0]}. ${parts.slice(1).join(' ')}`.trimEnd();
	const visited = play.visited.length ? [...play.visited] : [from.id];
	if (!visited.includes(end.id)) visited.push(end.id);
	const next: Play = { ...play, at: end.id, day: play.day + days, visited };
	if (rations !== undefined) next.rations = rations;
	return { play: next, ended: end.i, days, lost, weather, met, foraged, line };
}

/**
 * A day in camp where the party stands: a day passes, the weather turns, something may come by in the night (at
 * half the odds of travelling), and if rations are tracked the party eats a day's food and forages where it is.
 * Rolls come from the seed, the day and the hex, like a move.
 */
export function rest(c: Crawl, play: Play, tables?: Tables): Move {
	const h = c.hexes[partyHex(c, play)] as Hex;
	const r: Rng = makeRng(`${c.opts.seed}:day${play.day}:${h.id}:rest`);
	const weather = pick(r, WEATHER);
	const t = h.terrain === 'water' ? 'plains' : h.terrain;
	const met = chance(r, DANGER[h.terrain] / 2) ? pick(r, tableFor(tables, t) ?? MEET[t]) : null;
	const day = play.day + 1;
	const parts = [`Rested in ${h.id} (${h.terrain}${h.river ? ', river' : ''})`, `${weather}.`];
	if (met) parts.push(`In the night: ${met}.`);
	let rations = play.rations;
	let foraged = 0;
	if (rations !== undefined) {
		const fr = makeRng(`${c.opts.seed}:day${play.day}:${h.id}:rest:food`);
		if (chance(fr, FORAGE[h.terrain] + (h.river ? 1 / 6 : 0))) foraged = 1;
		const hungry = rations + foraged < 1;
		rations = Math.max(0, rations - 1 + foraged);
		if (foraged) parts.push("Foraged a day's food.");
		parts.push(hungry ? 'Out of food, and hungry.' : rations === 0 ? 'No food left.' : `Food left: ${rations} ${rations === 1 ? 'day' : 'days'}.`);
	}
	const line = `- Day ${day}: ${parts[0]}. ${parts.slice(1).join(' ')}`.trimEnd();
	const visited = play.visited.length ? [...play.visited] : [h.id];
	const next: Play = { ...play, at: h.id, day, visited };
	if (rations !== undefined) next.rations = rations;
	return { play: next, ended: h.i, days: 1, lost: false, weather, met, foraged, line };
}

/** The block's text with the play lines (`at:`, `day:`, `visited:`, and `rations:` if tracked) replaced by the new state. */
export function writePlay(src: string, play: Play): string {
	const keep = src.split('\n').filter((l) => !/^\s*(at|day|visited|rations)\s*:/i.test(l));
	while (keep.length && !keep[keep.length - 1]!.trim()) keep.pop();
	if (play.rations !== undefined) keep.push(`rations: ${play.rations}`);
	keep.push(`at: ${play.at}`, `day: ${play.day}`, `visited: ${play.visited.join(' ')}`);
	return keep.join('\n');
}

/**
 * The note after a move: the block between `lineStart` (its opening fence) and `lineEnd` (its closing fence)
 * gets the new play lines, and the log line goes under the block, after any earlier day lines.
 * Null if those lines aren't a hexwright block any more (the note changed under us).
 */
export function applyMove(note: string, lineStart: number, lineEnd: number, play: Play, logLine: string): string | null {
	const lines = note.split('\n');
	if (!/^\s*(`{3,}|~{3,})\s*hexwright\b/.test(lines[lineStart] ?? '') || !/^\s*(`{3,}|~{3,})\s*$/.test(lines[lineEnd] ?? '')) return null;
	const body = writePlay(lines.slice(lineStart + 1, lineEnd).join('\n'), play).split('\n');
	const before = lines.slice(0, lineStart + 1), after = lines.slice(lineEnd + 1);
	let at = 0;
	if (after[0] !== undefined && !after[0].trim() && /^- Days? \d/.test(after[1] ?? '')) at = 1;
	if (/^- Days? \d/.test(after[at] ?? '')) {
		while (/^- Days? \d/.test(after[at] ?? '')) at++;
		after.splice(at, 0, logLine);
	} else after.splice(0, 0, '', logLine);
	return [...before, ...body, lines[lineEnd] as string, ...after].join('\n');
}
