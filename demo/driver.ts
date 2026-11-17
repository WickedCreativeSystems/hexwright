// Browser demo: runs the real Hexwright plugin against the test shim, over a sample crawl note, and shows
// the note's text changing as the party travels, and the hex note "Open its note" would write.
import { App, installDomHelpers } from '../test/obsidian-shim';
import Hexwright from '../src/main';

installDomHelpers();

const block = (fog: boolean, seed = 'saltmarch') => `# The Saltmarch

Six-mile hexes. The party has a rumour and a week of food.

\`\`\`hexwright
seed: ${seed}
size: medium
terrain: mixed
rations: 7
fog: ${fog ? 'on' : 'off'}
\`\`\``;

type Ctx = { sourcePath: string; addChild: (c: { onload?: () => void }) => void; getSectionInfo: () => { text: string; lineStart: number; lineEnd: number } };
type Proc = (src: string, el: HTMLElement, c: Ctx) => void;

async function main() {
	const app = new App();
	const PATH = 'Saltmarch.md';
	app.notes.set(PATH, { path: PATH, content: block(true) });
	app.active = PATH;

	const hw = new Hexwright(app as never, { id: 'hexwright' } as never);
	hw.onload();
	const proc = (hw as never as { codeBlocks: Record<string, Proc> }).codeBlocks.hexwright!;

	const note = () => app.notes.get(PATH)!.content;
	const ctx: Ctx = {
		sourcePath: PATH,
		addChild: (c) => c.onload?.(),
		getSectionInfo: () => {
			const lines = note().split('\n');
			const lineStart = lines.findIndex((l) => l.startsWith('```hexwright'));
			const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
			return { text: note(), lineStart, lineEnd };
		},
	};
	const body = () => {
		const info = ctx.getSectionInfo();
		return note().split('\n').slice(info.lineStart + 1, info.lineEnd).join('\n');
	};

	const source = document.querySelector<HTMLElement>('#source');
	const board = document.querySelector<HTMLElement>('#board');
	const log = document.querySelector<HTMLElement>('#log');
	const opened = document.querySelector<HTMLElement>('#opened');
	const openedHead = document.querySelector<HTMLElement>('#opened-head');
	const fog = document.querySelector<HTMLInputElement>('#fog');

	const draw = () => {
		if (board) proc(body(), board, ctx);
		if (source) source.textContent = note().split('\n').filter((l) => !l.startsWith('- Day')).join('\n').trimEnd();
		if (log) {
			const days = note().split('\n').filter((l) => l.startsWith('- Day'));
			log.replaceChildren(...days.map((d) => Object.assign(document.createElement('li'), { textContent: d.slice(2) })));
		}
	};
	const flash = () => {
		if (!source) return;
		source.classList.remove('flash');
		void source.offsetWidth;
		source.classList.add('flash');
	};

	const process = app.vault.process;
	app.vault.process = async (f, fn) => {
		const out = await process(f, fn);
		draw();
		flash();
		return out;
	};
	// "Open its note": show the note it writes instead of opening it.
	app.workspace.getLeaf = () => ({
		openFile: async (f: { path: string }) => {
			const n = app.notes.get(f.path);
			if (opened) opened.textContent = n?.content ?? '';
			if (openedHead) openedHead.textContent = `The note it writes: ${f.path}`;
			opened?.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		},
	});
	// "Save as picture": hand the PNG to the browser as a download.
	app.vault.createBinary = async (path: string, data: ArrayBuffer) => {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([data], { type: 'image/png' }));
		a.download = path;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 5000);
		return { path } as never;
	};
	draw();

	const restart = (seed?: string) => {
		const keepSeed = seed ?? (/^seed: (.*)$/m.exec(note())?.[1] ?? 'saltmarch');
		app.notes.set(PATH, { path: PATH, content: block(fog?.checked ?? true, keepSeed) });
		for (const k of [...app.notes.keys()]) if (k !== PATH) app.notes.delete(k);
		if (opened) opened.textContent = '';
		if (openedHead) openedHead.textContent = 'The note it writes';
		draw();
	};
	fog?.addEventListener('change', () => {
		app.notes.get(PATH)!.content = note().replace(/^fog: .*$/m, `fog: ${fog.checked ? 'on' : 'off'}`);
		draw();
		flash();
	});
	document.querySelector('#reset')?.addEventListener('click', () => restart());
	document.querySelector('#seed')?.addEventListener('click', () => restart(Math.random().toString(36).slice(2, 8)));
}

void main();
