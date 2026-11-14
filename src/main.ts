import { MarkdownRenderChild, Plugin, type Editor } from 'obsidian';
import { parseBlock } from './block';
import { generate, newSeed } from './hex';
import { render, toDom } from './render';

class CrawlMap extends MarkdownRenderChild {
	constructor(el: HTMLElement, private src: string) {
		super(el);
	}

	onload() {
		this.draw();
	}

	draw() {
		const box = this.containerEl;
		box.empty();
		box.addClass('hexwright');
		const { opts, problems } = parseBlock(this.src);
		const crawl = generate(opts);
		const wrap = box.createDiv({ cls: 'hexwright-wrap' });
		toDom(render(crawl), wrap);
		const start = crawl.hexes[crawl.start];
		box.createDiv({ cls: 'hexwright-caption', text: `${crawl.cols} × ${crawl.rows} hexes, seed ${crawl.opts.seed}. The party is in ${start?.id ?? '?'}.` });
		for (const p of problems) box.createDiv({ cls: 'hexwright-problem', text: p });
	}
}

export default class Hexwright extends Plugin {
	onload() {
		this.registerMarkdownCodeBlockProcessor('hexwright', (src, el, ctx) => {
			ctx.addChild(new CrawlMap(el, src));
		});
		this.addCommand({
			id: 'insert-crawl',
			name: 'Insert a hex crawl',
			editorCallback: (editor: Editor) => editor.replaceSelection(`\`\`\`hexwright\nseed: ${newSeed()}\nsize: medium\nterrain: mixed\n\`\`\`\n`),
		});
	}
}
