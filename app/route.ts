import html from '../public/editor/index.html?raw';
export const dynamic='force-dynamic';
export const GET=()=>new Response(html.replace('href="style.css"','href="/editor/style.css"').replace('src="app.mjs"','src="/editor/app.mjs"'),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
