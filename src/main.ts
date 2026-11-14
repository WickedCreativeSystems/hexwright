import { MarkdownRenderChild, Notice, Plugin, TFile, normalizePath, type Editor, type MarkdownPostProcessorContext } from 'obsidian';
import { parseBlock } from './block';
import { generate, newSeed, type Crawl } from './hex';
import { hexNote, keyCrawl, type Key } from './keys';
import { render, toDom } from './render';

/** Where a hex's note goes: beside the note that holds the map. */
export function notePath(sourcePath: string, c: Crawl, i: number): string {
	const dir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
	return normalizePath(`${dir}${c.opts.seed} ${c.hexes[i]?.id ?? ''}.md`);
}

class CrawlMap extends MarkdownRenderChild {
	private crawl: Crawl;
	private keys: Key[];
	private picked: number | undefined;
	private problems: string[];

	constructor(private plugin: Hexwright, el: HTMLElement, src: string, private ctx: MarkdownPostProcessorContext) {
		super(el);
		const { opts, problems } = parseBlock(src);
		this.problems = problems;
		this.crawl = generate(opts);
		this.keys = keyCrawl(this.crawl);
	}

	onload() {
		this.draw();
	}

	draw() {
		const box = this.containerEl;
		const c = this.crawl;
		box.empty();
		box.addClass('hexwright');
		const wrap = box.createDiv({ cls: 'hexwright-wrap' });
		const svg = toDom(render(c, { keys: this.keys, picked: this.picked }), wrap);
		this.registerDomEvent(svg as unknown as HTMLElement, 'click', (e: MouseEvent) => {
			const id = (e.target as Element).closest('[data-hex]')?.getAttribute('data-hex');
			const h = id ? c.hexes.find((x) => x.id === id) : undefined;
			if (!h) return;
			this.picked = this.picked === h.i ? undefined : h.i;
			this.draw();
		});
		const start = c.hexes[c.start];
		box.createDiv({ cls: 'hexwright-caption', text: `${c.cols} × ${c.rows} hexes, seed ${c.opts.seed}. The party is in ${start?.id ?? '?'}. Click a hex to see what's there.` });
		for (const p of this.problems) box.createDiv({ cls: 'hexwright-problem', text: p });
		if (this.picked !== undefined) this.panel(box, this.picked);
	}

	private panel(box: HTMLElement, i: number) {
		const c = this.crawl, h = c.hexes[i], k = this.keys[i];
		if (!h || !k) return;
		const card = box.createDiv({ cls: 'hexwright-card' });
		card.createDiv({ cls: 'hexwright-card-title', text: `${h.id}: ${k.name}` });
		card.createDiv({ cls: 'hexwright-card-label', text: `${k.label}, ${h.terrain === 'water' ? 'open water' : h.terrain}${h.river ? ', river' : ''}${h.road ? ', road' : ''}` });
		card.createDiv({ text: k.line });
		if (k.rumour) {
			const r = card.createDiv({ cls: 'hexwright-rumour', text: k.rumour.text + ' ' });
			const go = r.createEl('a', { text: `Show ${c.hexes[k.rumour.to]?.id}`, href: '#' });
			const to = k.rumour.to;
			this.registerDomEvent(go, 'click', (e) => {
				e.preventDefault();
				this.picked = to;
				this.draw();
			});
		}
		const row = card.createDiv({ cls: 'hexwright-buttons' });
		const open = row.createEl('button', { text: 'Open its note' });
		this.registerDomEvent(open, 'click', () => void this.plugin.openHexNote(this.ctx.sourcePath, c, this.keys, i));
	}
}

export default class Hexwright extends Plugin {
	onload() {
		this.registerMarkdownCodeBlockProcessor('hexwright', (src, el, ctx) => {
			ctx.addChild(new CrawlMap(this, el, src, ctx));
		});
		this.addCommand({
			id: 'insert-crawl',
			name: 'Insert a hex crawl',
			editorCallback: (editor: Editor) => editor.replaceSelection(`\`\`\`hexwright\nseed: ${newSeed()}\nsize: medium\nterrain: mixed\n\`\`\`\n`),
		});
	}

	/** Open the hex's note, writing it first if it isn't there. */
	async openHexNote(sourcePath: string, c: Crawl, keys: Key[], i: number) {
		const path = notePath(sourcePath, c, i);
		let file = this.app.vault.getAbstractFileByPath(path);
		if (!file) {
			try {
				file = await this.app.vault.create(path, hexNote(c, keys, i));
			} catch (e) {
				new Notice(`Hexwright couldn't write ${path}: ${(e as Error).message}`);
				return;
			}
		}
		if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
	}
}
