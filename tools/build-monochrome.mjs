import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {startupPresentation} from '../embedded/presentation.mjs';
const root=new URL('../',import.meta.url);
const svg=await readFile(new URL('embedded/assets/chatgpt-knot.svg',root),'utf8');
const geometry={viewBox:svg.match(/viewBox="([^"]+)"/)[1],path:svg.match(/ d="([^"]+)"/)[1],contours:8};
let markup=await readFile(new URL('embedded/mono-overlay.template.html',root),'utf8');
let sectors='',fragments='';
for(let i=0;i<6;i++) {
  const a=(i*60-90)*Math.PI/180,b=((i+1)*60-90)*Math.PI/180;
  const coordinate=angle=>`${(243+1000*Math.cos(angle)).toFixed(2)} ${(243+1000*Math.sin(angle)).toFixed(2)}`;
  sectors+=`<clipPath id="sector-${i}"><path d="M243 243L${coordinate(a)}L${coordinate(b)}Z"/></clipPath>`;
  const angle=(i*60-60)*Math.PI/180;
  const dx=Math.round(1150*Math.cos(angle)),dy=Math.round(1150*Math.sin(angle));
  fragments+=`<g class="fragment" style="--dx:${dx}px;--dy:${dy}px"><g clip-path="url(#sector-${i})"><use href="#chatgpt-knot"/></g></g>`;
}
markup=markup.replace('__CHATGPT_KNOT_PATH__',geometry.path).replace('__CHATGPT_SECTORS__',sectors).replace('__CHATGPT_FRAGMENTS__',fragments);
await writeFile(new URL('embedded/overlay.html',root),markup);
await mkdir(new URL('embedded/assets/',root),{recursive:true});
await writeFile(new URL('embedded/assets/chatgpt-knot.svg',root),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${geometry.viewBox}"><path fill="white" fill-rule="evenodd" d="${geometry.path}"/></svg>`);
await mkdir(new URL('preview/',root),{recursive:true});
const driver=await readFile(new URL('tools/preview-driver.js',root),'utf8');
await writeFile(new URL('preview/monochrome.html',root),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex AI Entry — Animation Preview</title><style>html,body{margin:0;background:#080808;color:#f4f4f4;font-family:Segoe UI,Arial,sans-serif}.scene{z-index:10}.preview-workspace{position:fixed;inset:0;display:grid;align-content:center;padding:10vw}.preview-workspace small{font:10px Consolas,monospace;letter-spacing:.2em;color:#777}.preview-workspace h1{font-weight:300;font-size:clamp(28px,5vw,60px);margin:24px 0}.preview-workspace p{color:#888;font-size:13px}.preview-replay{position:fixed;z-index:20;right:4vw;top:30px;background:#111;color:white;border:1px solid #555;padding:10px 18px;font:11px Consolas,monospace;cursor:pointer}.preview-replay[hidden]{display:none}</style></head><body><main class="preview-workspace"><small>CODEX / WORKSPACE PREVIEW</small><h1>Ready for your next idea.</h1><p>This is an animation demo. Your real workspace appears after startup.</p></main><button class="preview-replay" hidden aria-label="Replay animation">REPLAY ↻</button>${markup}<script>const previewPresentation=${startupPresentation.toString()};${driver}</script></body></html>`);
console.log(`Built monochrome overlay: ${geometry.contours} vector contours`);
