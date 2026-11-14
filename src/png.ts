// SVG to PNG through a canvas, as Mapsmith does it. Gives the PNG as base64.

export async function svgToPng(svg: string, w: number, h: number): Promise<string> {
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	try {
		const img = new Image();
		await new Promise<void>((ok, fail) => {
			img.onload = () => ok();
			img.onerror = () => fail(new Error('The map would not draw.'));
			img.src = url;
		});
		const c = createEl('canvas');
		c.width = w;
		c.height = h;
		const ctx = c.getContext('2d');
		if (!ctx) throw new Error('No canvas to draw on.');
		ctx.drawImage(img, 0, 0, w, h);
		const data = c.toDataURL('image/png');
		return data.slice(data.indexOf(',') + 1);
	} finally {
		URL.revokeObjectURL(url);
	}
}
