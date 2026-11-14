// The `hexwright` code block: `key: value` lines in, crawl options out. Kept apart from main.ts so it can
// be tested without Obsidian.

import { DEFAULTS, LEANS, SIZES, type CrawlOptions, type Lean, type SizeName } from './hex';

export interface Parsed {
	opts: CrawlOptions;
	problems: string[];
}

export function parseBlock(src: string): Parsed {
	const opts: CrawlOptions = { ...DEFAULTS };
	const problems: string[] = [];
	for (const raw of src.split('\n')) {
		const line = raw.replace(/#.*$/, '').trim();
		if (!line) continue;
		const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
		if (!m) {
			problems.push(`Not a "key: value" line: ${line}`);
			continue;
		}
		const key = (m[1] as string).toLowerCase(), val = (m[2] as string).trim();
		switch (key) {
			case 'seed':
				if (val) opts.seed = val;
				break;
			case 'size': {
				const named = SIZES[val.toLowerCase() as SizeName];
				const wh = /^(\d+)\s*x\s*(\d+)$/i.exec(val);
				if (named) [opts.cols, opts.rows] = named;
				else if (wh) {
					opts.cols = Math.max(4, Math.min(40, Number(wh[1])));
					opts.rows = Math.max(4, Math.min(40, Number(wh[2])));
				} else problems.push(`size should be small, medium, large or columns x rows (like 12x10), not "${val}"`);
				break;
			}
			case 'terrain':
				if ((LEANS as string[]).includes(val.toLowerCase())) opts.lean = val.toLowerCase() as Lean;
				else problems.push(`terrain should be one of ${LEANS.join(', ')}, not "${val}"`);
				break;
			case 'start':
				opts.start = val;
				break;
			default:
				problems.push(`Hexwright doesn't know "${key}"`);
		}
	}
	return { opts, problems };
}
