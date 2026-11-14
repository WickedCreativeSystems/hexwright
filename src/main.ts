import { MarkdownRenderChild, Notice, Plugin, TFile, normalizePath, type Editor, type MarkdownPostProcessorContext } from 'obsidian';
import { parseBlock } from './block';
import { generate, newSeed, type Crawl } from './hex';
import { hexNote, keyCrawl, type Key } from './keys';
import { render, toDom } from './render';
import { applyMove, canTravel, daysTo, partyHex, seenSet, travel, type Play } from './travel';

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
	private play: Play;
	/** fog lifted for this view only (the referee peeking); not saved */
	private reveal = false;

	constructor(private plugin: Hexwright, el: HTMLElement, src: string, private ctx: MarkdownPostProcessorContext) {
		super(el);
		const { opts, play, problems } = parseBlock(src);
		this.problems = problems;
		this.play = play;
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
		const at = partyHex(c, this.play);
		const seen = this.play.fog && !this.reveal ? seenSet(c, this.play) : undefined;
		const svg = toDom(render(c, { keys: this.keys, picked: this.picked, at, seen }), wrap);
		this.registerDomEvent(svg as unknown as HTMLElement, 'click', (e: MouseEvent) => {
			const id = (e.target as Element).closest('[data-hex]')?.getAttribute('data-hex');
			const h = id ? c.hexes.find((x) => x.id === id) : undefined;
			if (!h) return;
			this.picked = this.picked === h.i ? undefined : h.i;
			this.draw();
		});
		const day = this.play.day ? `Day ${this.play.day}. ` : '';
		const cap = box.createDiv({ cls: 'hexwright-caption', text: `${c.cols} × ${c.rows} hexes, seed ${c.opts.seed}. ${day}The party is in ${c.hexes[at]?.id ?? '?'}. Click a hex to see what's there, or a hex next to the party to travel. ` });
		if (this.play.fog) {
			const peek = cap.createEl('a', { text: this.reveal ? 'Hide what the party hasn’t seen' : 'Show the whole map', href: '#' });
			this.registerDomEvent(peek, 'click', (e) => {
				e.preventDefault();
				this.reveal = !this.reveal;
				this.draw();
			});
		}
		for (const p of this.problems) box.createDiv({ cls: 'hexwright-problem', text: p });
		if (this.picked !== undefined) this.panel(box, this.picked);
	}

	private panel(box: HTMLElement, i: number) {
		const c = this.crawl, h = c.hexes[i], k = this.keys[i];
		if (!h || !k) return;
		const card = box.createDiv({ cls: 'hexwright-card' });
		const hidden = this.play.fog && !this.reveal && !seenSet(c, this.play).has(i);
		if (hidden) {
			card.createDiv({ cls: 'hexwright-card-title', text: h.id });
			card.createDiv({ text: 'The party hasn’t seen this hex yet.' });
			return;
		}
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
		if (canTravel(c, this.play, i)) {
			const from = c.hexes[partyHex(c, this.play)];
			const d = from ? daysTo(from, h) : 1;
			const go = row.createEl('button', { cls: 'mod-cta', text: `Travel here (${d === 1 ? '1 day' : `${d} days`})` });
			this.registerDomEvent(go, 'click', () => void this.travel(i));
		}
		const open = row.createEl('button', { text: 'Open its note' });
		this.registerDomEvent(open, 'click', () => void this.plugin.openHexNote(this.ctx.sourcePath, c, this.keys, i));
	}

	/** Move the party into hex `to`: write the new state into the block and the day into the note. */
	private async travel(to: number) {
		const move = travel(this.crawl, this.keys, this.play, to);
		const info = this.ctx.getSectionInfo(this.containerEl);
		const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
		if (!move || !info || !(file instanceof TFile)) {
			new Notice('Hexwright couldn’t find this map in its note to save the move.');
			return;
		}
		let ok = true;
		await this.plugin.app.vault.process(file, (data) => {
			const next = applyMove(data, info.lineStart, info.lineEnd, move.play, move.line);
			if (next === null) {
				ok = false;
				return data;
			}
			return next;
		});
		if (!ok) new Notice('The note changed before the move could be saved. Try again.');
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
			editorCallback: (editor: Editor) => editor.replaceSelection(`\`\`\`hexwright\nseed: ${newSeed()}\nsize: medium\nterrain: mixed\nfog: off   # on hides hexes the party hasn't seen\n\`\`\`\n`),
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
