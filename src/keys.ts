// What is in each hex: a key for every one, from tables weighted by terrain, and rumours that point across
// the map to another hex by its number. All original lists.

import type { Crawl, Hex, Terrain } from './hex';
import { hexDistance } from './hex';
import { chance, fork, makeRng, pick, shuffle, type Rng } from './rng';

export type KeyKind = 'town' | 'village' | 'ruin' | 'lair' | 'landmark' | 'resource' | 'empty';

export interface Key {
	kind: KeyKind;
	name: string; // "Saltford", "The Drowned Tower", or the feature for an empty hex
	label: string; // "Market town", "Ruined tower", "Lair", "Open moor"
	line: string; // one sentence on it
	/** for a ruin: the Mapsmith dungeon kind its note opens as */
	dungeon?: 'crypt' | 'keep' | 'mine';
	rumour?: { to: number; text: string };
}

const START = ['Ash', 'Bram', 'Cold', 'Elder', 'Fen', 'Grey', 'Hollow', 'Ivy', 'Kettle', 'Lark', 'Marrow', 'North', 'Oak', 'Pike', 'Quarry', 'Raven', 'Salt', 'Thorn', 'Umber', 'Vale', 'Wick', 'Yarrow', 'Brindle', 'Copper', 'Dun', 'Gull', 'Heron', 'Low', 'Mill', 'Stone', 'Tallow', 'Wether', 'Black', 'Bright', 'Crow', 'Elm', 'Fallow', 'Gold', 'Hart', 'Rook'];
const END = ['ford', 'bury', 'wick', 'mere', 'stead', 'holm', 'by', 'ton', 'field', 'gate', 'haven', 'bridge', 'well', 'moor', 'cross', 'hithe', 'combe', 'dale', 'marsh', 'stow'];
const RIVER_END = ['ford', 'bridge', 'bank', 'weir'];
const COAST_END = ['haven', 'mouth', 'strand', 'port'];

export function placeName(r: Rng, h: Hex): string {
	const ends = h.river && chance(r, 0.5) ? RIVER_END : h.coast && chance(r, 0.5) ? COAST_END : END;
	const s = pick(r, START), e = pick(r, ends);
	return s.toLowerCase().endsWith(e[0] as string) ? `${s}${e.slice(1)}` : `${s}${e}`;
}

const TOWN_LINES = [
	'A market town with one good inn, one bad one and a square between.',
	'Walled when times were worse. The gates stand open now.',
	'The roads meet here, and so do the tax collectors.',
	'A wool town, rich and proud of it, with a fair that draws people from three days away.',
	'A stranger is talked about here by supper.',
];
const VILLAGE_LINES = [
	'A green, a well, a mill and an alehouse.',
	'Everyone farms, and everyone watches the road.',
	'A handful of houses that owe rent to someone far away.',
	'They brew something here that travellers ask about.',
	'The headman wants help and will not say with what.',
];

interface Thing {
	name: string[];
	label: string;
	lines: string[];
	dungeon?: 'crypt' | 'keep' | 'mine';
}

const RUINS: Thing[] = [
	{ name: ['The Drowned Tower', 'The Leaning Tower', 'The Old Watch', 'Grey Tower', 'The Signal Tower'], label: 'Ruined tower', lines: ['Its stair still climbs to a room with no roof.', 'A light shows in its top window some nights.', 'The door is new, and barred from inside.'], dungeon: 'keep' },
	{ name: ['The Old Keep', 'The Burnt Hall', 'The Broken Keep', 'The Lord’s Hall'], label: 'Ruined keep', lines: ['Its last lord died owing everyone, and the debts went into the walls with him.', 'Half the roof is gone and something nests in the other half.', 'The cellars go further down than the keep was ever tall.'], dungeon: 'keep' },
	{ name: ['The Barrow', 'The Long Barrow', 'The King’s Mound', 'The Old Graves'], label: 'Barrow', lines: ['A grass mound with a stone door that someone has dug out.', 'The farmers leave milk on its doorstone and do not look back.', 'Its door faces the sunset and opens on one night a year.'], dungeon: 'crypt' },
	{ name: ['The Old Workings', 'The Copper Pits', 'The Deep Adit', 'The Silver Delve'], label: 'Old mine', lines: ['The miners left in a hurry and left their tools.', 'Cold air breathes out of the adit, and sometimes a sound.', 'The seam ran out, people say, but the company never said why it closed.'], dungeon: 'mine' },
	{ name: ['The Sunken Chapel', 'The Abbey Ruins', 'The Roofless Church', 'The Hermitage'], label: 'Ruined chapel', lines: ['Its bell is gone, but people hear it ring.', 'The crypt below is dry and full.', 'Pilgrims still come, though the brothers left a hundred years ago.'], dungeon: 'crypt' },
];

const LAIRS: Partial<Record<Terrain, Thing>> & { any: Thing } = {
	any: { name: ['Wolf Den', 'The Bone Hollow', 'Bandit Camp', 'Ogre’s Larder'], label: 'Lair', lines: ['Tracks as big as a hand, and howling close to the farms.', 'Picked bones by the entrance, and fresh ones.', 'Smoke by day, and a watcher on the rocks.', 'Whatever lives here takes sheep, and lately more than sheep.'] },
	forest: { name: ['Spider Wood', 'The Owlbear Hollow', 'The Hanging Grove', 'Outlaw Camp'], label: 'Lair', lines: ['Webs between the trees as high as a man.', 'Bark torn off the trunks at shoulder height.', 'Old ropes still hang from the branches, and the birds keep away.', 'Outlaws who rob the road and pay the nearest village not to see.'] },
	hills: { name: ['Goblin Warren', 'The Troll Bridge', 'Gnoll Camp', 'The Worg Den'], label: 'Lair', lines: ['Holes all over the hillside, and more each spring.', 'Something under the old bridge asks a toll.', 'Drums at night, and fires on the ridge.', 'Big grey wolves with riders, seen at dusk.'] },
	mountains: { name: ['The Wyvern Crag', 'Giant’s Seat', 'Harpy Rocks', 'The Dragon’s Shelf'], label: 'Lair', lines: ['A shadow crosses the valley at noon and the goats scatter.', 'Boulders as big as cottages, stacked like a wall.', 'Screeching from the rocks, and feathers on the path.', 'A ledge black with old fire, and something gold catching the sun.'] },
	swamp: { name: ['The Hag’s Hut', 'Lizardfolk Mound', 'The Will-o’-Wisp Fen', 'The Sunken Village'], label: 'Lair', lines: ['A hut on legs that is never in the same place twice.', 'Reed huts on a mound, and spears in the reeds.', 'Lights in the fen that walk away when you follow them.', 'Rooftops in the water, and someone still rings the bell.'] },
};

const LANDMARKS: Partial<Record<Terrain, Thing>> & { any: Thing } = {
	any: { name: ['The Standing Stones', 'The Hanging Tree', 'The Old Milestone', 'The Giant’s Chair'], label: 'Landmark', lines: ['Nine stones in a ring, and a tenth that lies apart.', 'Everyone gives directions from it, and nobody goes close.', 'Someone has carved a map into it, and the map is wrong.', 'A rock shaped like a seat for a giant, warm to the touch at midnight.'] },
	forest: { name: ['The Great Oak', 'The Green Chapel', 'The Moss Stair'], label: 'Landmark', lines: ['An oak so old the village says it was here first.', 'A clearing where the trees grow in a perfect ring.', 'Steps cut into the hillside, going up into the trees.'] },
	hills: { name: ['The White Horse', 'The Beacon', 'The Old Fort'], label: 'Landmark', lines: ['A horse cut into the chalk, as long as a village.', 'A beacon on the summit, laid and ready to light.', 'Earth ramparts from a war nobody remembers.'] },
	mountains: { name: ['The Needle', 'The Pass Shrine', 'The Frozen Falls'], label: 'Landmark', lines: ['A spire of rock you can see from three days away.', 'A shrine at the top of the pass where travellers leave a coin.', 'A waterfall frozen in summer.'] },
	swamp: { name: ['The Drowned Bell Tower', 'The Causeway', 'The Black Pool'], label: 'Landmark', lines: ['A bell tower up to its windows in the bog.', 'An old stone causeway, the only dry road across.', 'A pool so still and dark it shows the stars by day.'] },
	plains: { name: ['The Lone Tree', 'The Battlefield', 'The Crossroads Gallows'], label: 'Landmark', lines: ['One tree in a day’s ride, with a well beneath it.', 'Rusted arrowheads come up with every ploughing.', 'A gallows at the crossroads, empty for now.'] },
	water: { name: ['The Wreck', 'Gull Rock', 'The Light'], label: 'Landmark', lines: ['A ship on the rocks with her masts still standing.', 'A rock white with birds, and a cave at the waterline.', 'A lighthouse on an islet, still lit, though nobody keeps it.'] },
};

const RESOURCES: Partial<Record<Terrain, Thing>> & { any: Thing } = {
	any: { name: ['Herb Meadow', 'Clear Spring'], label: 'Resource', lines: ['Healing herbs grow thick here in spring.', 'A spring that never freezes and never fouls.'] },
	forest: { name: ['Old Timber', 'Honey Wood', 'Truffle Glade'], label: 'Resource', lines: ['Oaks fit for a ship’s keel, if anyone dared cut them.', 'Wild bees, and honey worth a silver a jar.', 'Truffles, and the pigs to find them.'] },
	hills: { name: ['Iron Seam', 'Slate Quarry', 'Flint Beds'], label: 'Resource', lines: ['Red rock and iron in it, close to the surface.', 'Good slate, and a quarry half dug.', 'Flint by the cartload.'] },
	mountains: { name: ['Silver Vein', 'Gem Gully', 'Ice Caves'], label: 'Resource', lines: ['A silver vein where the rock split in a storm.', 'River gravel with garnets in it.', 'Ice all year, worth money in the towns in August.'] },
	swamp: { name: ['Peat Cuttings', 'Eel Pools', 'Bog Iron'], label: 'Resource', lines: ['Peat that burns hot and long.', 'Eels by the thousand, and people who trap them.', 'Bog iron, rusty lumps you can smelt.'] },
	plains: { name: ['Wild Horses', 'Salt Lick', 'Clay Pits'], label: 'Resource', lines: ['A herd of wild horses, if someone can catch them.', 'A salt lick, and the deer that come to it.', 'Fine clay, and a potter’s kiln gone cold.'] },
};

const EMPTY: Record<Terrain, { label: string; lines: string[] }> = {
	plains: { label: 'Open country', lines: ['Long grass and a wide sky.', 'Fields gone back to meadow.', 'A shepherd’s hut, empty, with a cold hearth.', 'Wind, and nothing else for miles.', 'A track with fresh cart ruts.'] },
	forest: { label: 'Woods', lines: ['Close trees and a deer path.', 'A woodcutter’s clearing, the stumps grey with age.', 'Birdsong, then no birdsong.', 'Brambles thick enough to stop a horse.', 'A stream under the trees, good water.'] },
	hills: { label: 'Hills', lines: ['Sheep, a dry-stone wall and a view.', 'Heather and bog cotton.', 'A cairn on the top, added to by every traveller.', 'Steep going, and a cold wind.', 'A shepherd who has seen something and wants to tell it.'] },
	mountains: { label: 'Mountains', lines: ['Scree, cold and thin air.', 'A goat track along a ledge.', 'Snow even now on the high ground.', 'An avalanche scar, fresh.', 'Eagles, and the bones of what they eat.'] },
	swamp: { label: 'Marsh', lines: ['Reeds over your head and water to your knees.', 'Midges, and a smell of rot.', 'A punt tied to a stake, no one near.', 'Firm ground, if you find it.', 'Herons, and something bigger moving in the water.'] },
	water: { label: 'Open water', lines: ['Grey water and gulls.', 'A fishing boat far out.', 'Choppy water and a cold wind off it.', 'Calm, and a long swell.'] },
};

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function direction(a: Hex, b: Hex): string {
	const dx = (b.col - a.col) * 0.866, dy = b.row + (b.col % 2) * 0.5 - (a.row + (a.col % 2) * 0.5);
	const ang = Math.atan2(dx, -dy); // 0 = north, clockwise
	return DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8] as string;
}

function rumourText(r: Rng, from: Hex, to: Hex, k: Key): string {
	const days = hexDistance([from.col, from.row], [to.col, to.row]);
	const where = `${days === 1 ? 'a day' : `${days} days`} ${direction(from, to)}, in ${to.id}`;
	const what: Record<KeyKind, string[]> = {
		town: [`${k.name} is hiring guards`, `prices are high in ${k.name}`, `there's trouble in ${k.name}`],
		village: [`${k.name} has stopped paying its rents`, `a stranger came to ${k.name} and stayed`, `${k.name} wants help and pays in silver`],
		ruin: [`${k.name.replace(/^The /, 'the ')} isn't as empty as it looks`, `there's treasure under ${k.name.replace(/^The /, 'the ')}`, `someone has been digging at ${k.name.replace(/^The /, 'the ')}`],
		lair: [`something has made its home at ${k.name.replace(/^The /, 'the ')}`, `don't go near ${k.name.replace(/^The /, 'the ')} after dark`, `there's a bounty on whatever's at ${k.name.replace(/^The /, 'the ')}`],
		landmark: [`there's a way in at ${k.name.replace(/^The /, 'the ')}`, `a pedlar saw lights at ${k.name.replace(/^The /, 'the ')}`, `${k.name.replace(/^The /, 'the ')} marks the old border`],
		resource: [`there's money to be made at ${k.name}`, `a guild wants someone to look at ${k.name}`, `nobody has claimed ${k.name} yet`],
		empty: ['the road is quiet'],
	};
	return `They say ${pick(r, what[k.kind])}: ${where}.`;
}

function pickFor(things: Partial<Record<Terrain, Thing>> & { any: Thing }, t: Terrain, r: Rng): Thing {
	return things[t] && chance(r, 0.7) ? (things[t]) : things.any;
}

/** A key for every hex of the crawl, in hex order. */
export function keyCrawl(c: Crawl): Key[] {
	const r = makeRng(c.opts.seed + ':keys');
	const used = new Set<string>();
	const unique = (rr: Rng, names: string[], fallback: (rr: Rng) => string) => {
		for (const n of shuffle(rr, [...names])) if (!used.has(n)) { used.add(n); return n; }
		for (let k = 0; k < 20; k++) { const n = fallback(rr); if (!used.has(n)) { used.add(n); return n; } }
		return fallback(rr);
	};
	const keys: Key[] = c.hexes.map((h) => {
		const hr = fork(r, h.id);
		const thing = (t: Thing, kind: KeyKind): Key => {
			let base = '';
			const name = unique(hr, t.name, (rr) => `${(base = pick(rr, t.name))} near ${placeName(rr, h)}`);
			// where each name has its own line (landmarks, lairs, resources), keep them together
			const at = t.name.indexOf(base || name);
			const line = t.lines.length === t.name.length && at >= 0 ? (t.lines[at] as string) : pick(hr, t.lines);
			return { kind, name, label: t.label, line, ...(t.dungeon ? { dungeon: t.dungeon } : {}) };
		};
		if (h.town) {
			const name = unique(hr, [], (rr) => placeName(rr, h));
			return { kind: 'town', name, label: h.coast ? 'Port town' : h.river ? 'River town' : 'Market town', line: pick(hr, TOWN_LINES) };
		}
		const e = EMPTY[h.terrain];
		const empty: Key = { kind: 'empty', name: e.label, label: e.label, line: pick(hr, e.lines) };
		if (h.terrain === 'water') return chance(hr, 0.08) ? thing(pickFor(LANDMARKS, 'water', hr), 'landmark') : empty;
		// weights by terrain: village, ruin, lair, landmark, resource; the rest stay empty
		const w: Record<Exclude<Terrain, 'water'>, number[]> = {
			plains: [0.14, 0.07, 0.04, 0.07, 0.06],
			forest: [0.05, 0.07, 0.09, 0.06, 0.07],
			hills: [0.06, 0.1, 0.08, 0.07, 0.08],
			mountains: [0.01, 0.08, 0.1, 0.07, 0.09],
			swamp: [0.03, 0.07, 0.1, 0.07, 0.07],
		};
		const roll = hr();
		let acc = 0;
		const kinds: KeyKind[] = ['village', 'ruin', 'lair', 'landmark', 'resource'];
		for (let k = 0; k < kinds.length; k++) {
			acc += (w[h.terrain])[k] as number;
			if (roll >= acc) continue;
			const kind = kinds[k] as KeyKind;
			if (kind === 'village') {
				const name = unique(hr, [], (rr) => placeName(rr, h));
				return { kind, name, label: h.coast ? 'Fishing village' : 'Village', line: pick(hr, VILLAGE_LINES) };
			}
			if (kind === 'ruin') return thing(pick(hr, h.terrain === 'mountains' || h.terrain === 'hills' ? RUINS : RUINS.filter((x) => x.dungeon !== 'mine')), kind);
			if (kind === 'lair') return thing(pickFor(LAIRS, h.terrain, hr), kind);
			if (kind === 'landmark') return thing(pickFor(LANDMARKS, h.terrain, hr), kind);
			return thing(pickFor(RESOURCES, h.terrain, hr), kind);
		}
		return empty;
	});

	// Rumours: about one hex in three carries one, pointing at a hex with something in it, 2 to 6 days off.
	const rr = fork(r, 'rumours');
	const worth = keys.map((k, i) => (k.kind !== 'empty' ? i : -1)).filter((i) => i >= 0);
	for (const h of c.hexes) {
		const k = keys[h.i] as Key;
		if (h.terrain === 'water' || !chance(rr, k.kind === 'town' || k.kind === 'village' ? 0.9 : 0.3)) continue;
		const far = worth.filter((i) => {
			const t = c.hexes[i] as Hex;
			const d = hexDistance([h.col, h.row], [t.col, t.row]);
			return d >= 2 && d <= 6;
		});
		if (!far.length) continue;
		const to = pick(rr, far);
		k.rumour = { to, text: rumourText(rr, h, c.hexes[to] as Hex, keys[to] as Key) };
	}
	return keys;
}

/** The note for one hex: what it is, the rumour heard there, and a Mapsmith block for a place or a ruin. */
export function hexNote(c: Crawl, keys: Key[], i: number): string {
	const h = c.hexes[i] as Hex, k = keys[i] as Key;
	const seed = `${c.opts.seed}-${h.id}`;
	const lines = [`# ${h.id}: ${k.name}`, '', `**${k.label}** in ${h.terrain === 'water' ? 'open water' : h.terrain}${h.river ? ', on a river' : ''}${h.road ? ', on the road' : ''}. ${k.line}`, ''];
	if (k.rumour) lines.push(`Heard here: ${k.rumour.text}`, '');
	if (k.kind === 'town' || k.kind === 'village') {
		lines.push('```mapsmith', `seed: ${seed}`, `size: ${k.kind === 'town' ? 'town' : 'village'}`, `water: ${h.coast ? 'coast' : h.river ? 'river' : 'none'}`, `terrain: ${h.terrain === 'hills' || h.terrain === 'mountains' ? 'hills' : 'flat'}`, `name: ${k.name}`, '```', '');
		lines.push('The map above needs the free Mapsmith plugin (Settings, Community plugins, search "Mapsmith").', '');
	} else if (k.kind === 'ruin' && k.dungeon) {
		lines.push('```mapsmith', 'map: dungeon', `kind: ${k.dungeon}`, 'size: dungeon', `seed: ${seed}`, `name: ${k.name}`, '```', '');
		lines.push('The map above needs the free Mapsmith plugin (Settings, Community plugins, search "Mapsmith").', '');
	}
	lines.push('## Notes', '', '');
	return lines.join('\n');
}
