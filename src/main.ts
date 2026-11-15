import { MarkdownRenderChild, Notice, Platform, Plugin, TFile, base64ToArrayBuffer, normalizePath, type Editor, type MarkdownPostProcessorContext } from 'obsidian';
import { parseBlock } from './block';
import { generate, newSeed, type Crawl } from './hex';
import { hexNote, keyCrawl, type Key } from './keys';
import { svgToPng } from './png';
import { HEX, centre, render, size, toDom, toString } from './render';
import { applyMove, canTravel, daysTo, partyHex, seenSet, travel, type Play } from './travel';

/** Smallest on-screen size of the map, as a share of its SVG units: 0.6 keeps a hex about 36 px across. */
const MIN_SCALE = 0.6;

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
		const scrolled = box.querySelector('.hexwright-wrap')?.scrollLeft;
		box.empty();
		box.addClass('hexwright');
		const wrap = box.createDiv({ cls: 'hexwright-wrap' });
		const at = partyHex(c, this.play);
		const seen = this.play.fog && !this.reveal ? seenSet(c, this.play) : undefined;
		const svg = toDom(render(c, { keys: this.keys, picked: this.picked, at, seen }), wrap);
		// On a narrow pane a big map would shrink its hexes below a fingertip; keep them at least MIN_SCALE and scroll sideways instead.
		const [w] = size(c);
		wrap.setCssProps({ '--hexwright-min-width': `${Math.round(w * MIN_SCALE)}px` });
		if (scrolled !== undefined) wrap.scrollLeft = scrolled;
		else {
			// The block is drawn before Obsidian puts it in the page, so wait for it to have a width.
			const party = c.hexes[at];
			let tries = 0;
			const aim = () => {
				if (!party || ++tries > 120) return;
				if (wrap.clientWidth === 0) return void window.requestAnimationFrame(aim);
				if (wrap.scrollWidth <= wrap.clientWidth) return;
				const k = (svg as unknown as SVGSVGElement).getBoundingClientRect().width / w;
				wrap.scrollLeft = centre(party)[0] * k - wrap.clientWidth / 2;
			};
			window.requestAnimationFrame(aim);
		}
		const save = () => this.plugin.savePng(this.ctx.sourcePath, c, render(c, { keys: this.keys, at, seen }));
		this.registerDomEvent(svg as unknown as HTMLElement, 'click', (e: MouseEvent) => {
			const id = (e.target as Element).closest('[data-hex]')?.getAttribute('data-hex');
			const h = id ? c.hexes.find((x) => x.id === id) : undefined;
			if (!h) return;
			this.picked = this.picked === h.i ? undefined : h.i;
			this.draw();
		});
		const day = this.play.day ? `Day ${this.play.day}. ` : '';
		const cap = box.createDiv({ cls: 'hexwright-caption', text: `${c.cols} × ${c.rows} hexes, seed ${c.opts.seed}. ${day}The party is in ${c.hexes[at]?.id ?? '?'}. ${Platform.isMobile ? 'Tap' : 'Click'} a hex to see what's there, or a hex next to the party to travel. ` });
		if (this.play.fog) {
			const peek = cap.createEl('a', { text: this.reveal ? 'Hide what the party hasn’t seen' : 'Show the whole map', href: '#' });
			this.registerDomEvent(peek, 'click', (e) => {
				e.preventDefault();
				this.reveal = !this.reveal;
				this.draw();
			});
		}
		const tools = box.createDiv({ cls: 'hexwright-buttons' });
		const pic = tools.createEl('button', { text: 'Save as picture' });
		this.registerDomEvent(pic, 'click', () => {
			pic.disabled = true;
			save()
				.catch((e: unknown) => new Notice(`Couldn’t save the picture: ${e instanceof Error ? e.message : String(e)}`))
				.finally(() => (pic.disabled = false));
		});
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

	/**
	 * Writes the map as it is shown (fog and all) as a PNG beside the note, with hexes 100 pixels from flat side to
	 * flat side and the grid starting at the top-left corner, so a virtual tabletop's hex grid can be laid on it.
	 */
	async savePng(sourcePath: string, c: Crawl, tree: ReturnType<typeof render>) {
		const scale = 100 / (Math.sqrt(3) * HEX);
		const [w, h] = size(c).map((v) => Math.round(v * scale)) as [number, number];
		tree.a.width = w;
		tree.a.height = h;
		const bin = base64ToArrayBuffer(await svgToPng(toString(tree), w, h));
		const dir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
		const path = normalizePath(`${dir}${c.opts.seed.replace(/[\\/:*?"<>|#^[\]]/g, '')} hexes.png`);
		const old = this.app.vault.getAbstractFileByPath(path);
		if (old instanceof TFile) await this.app.vault.modifyBinary(old, bin);
		else await this.app.vault.createBinary(path, bin);
		new Notice(`Saved ${path}: ${c.cols} by ${c.rows} flat-topped hexes, 100 pixels from flat side to flat side (115 corner to corner), ${w} by ${h} pixels.`);
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
