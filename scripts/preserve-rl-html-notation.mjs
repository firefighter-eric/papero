import {readFile,writeFile,rename,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {load} from 'cheerio'
import {sha256} from './paper-lib.mjs'
import {withExclusivePaperLock} from './catalog-lock.mjs'
import {updateCatalog} from './import-paper.mjs'
const args=process.argv.slice(2),arg=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw Error(`Missing ${k}`);return args[i+1]}
const data=arg('--data'),recipeBytes=await readFile(arg('--recipe')),recipe=JSON.parse(recipeBytes)
for(const spec of recipe.papers)await withExclusivePaperLock(data,spec.id,async()=>{
 const dir=path.join(data,'papers',spec.id),file=path.join(dir,'paper.json'),before=await readFile(file),p=JSON.parse(before)
 if(p.source.sha256!==spec.originalHtmlSha256)throw Error('Original source fingerprint mismatch')
 if(p.source.repairs?.some(r=>r.method==='preserve-formal-chess-notation-and-clear-compiler-warning'&&r.recipeSha256===sha256(recipeBytes)))return
 const changes=[]
 for(const target of spec.blocks){const b=p.blocks.find(b=>b.id===target.id&&b.sourceId===target.sourceId);if(!b||sha256(b.en)!==target.previousSha256)throw Error('Block fingerprint mismatch');const $=load(b.en,{},false),oldIds=$('[id]').map((_,e)=>$(e).attr('id')).get(),literals=[]
  if(target.mode==='empty-compiler-warning') {if(!$.text().includes('marginparsep has been altered.'))throw Error('Unexpected compiler warning');$.root().children().first().html(oldIds.slice(1).map(id=>`<span id="${id}"></span>`).join(''))}
  else if(target.mode==='literal-chess-pv-and-scores') {for(let row=0;row<6;row++)for(let col=1;col<=4;col++){const cell=$(`[id="S0.T2.2.${3+row*3}.${col}"]`);if(cell.length!==1||cell.find('code').length)throw Error('Chess cell structure mismatch');literals.push({cellId:cell.attr('id'),textSha256:sha256(cell.text()),htmlSha256:sha256(cell.html())});cell.html('<code>'+cell.html()+'</code>')}if(literals.length!==24)throw Error('Chess PV/score count mismatch')}
  else if(target.mode==='literal-chess-games'){for(const cell of $('*').toArray()){for(const node of [...(cell.children||[])])if(node.type==='text'&&/^\s*1\.\s+(?:[KQRBN]?[a-h][1-8]|[a-h][1-8])/.test(node.data)&&node.data.length>100){const literal=node.data;literals.push({cellId:$(cell).attr('id'),textSha256:sha256(literal)});const code=$('<code></code>').text(literal);$(node).replaceWith(code)}}if(literals.length!==10)throw Error('Expected ten complete chess game scores')}
  else throw Error('Unknown repair mode')
  if(oldIds.some(id=>$(`[id="${id}"]`).length!==1))throw Error('Anchor changed')
  const en=$.html();changes.push({id:b.id,sourceId:b.sourceId,mode:target.mode,previousSha256:sha256(b.en),correctedSha256:sha256(en),literals});b.en=en;b.zh=null;delete b.translation
 }
 const archive=path.join(data,'..','archive',p.id+'-before-notation-'+Date.now());await mkdir(archive,{recursive:true});await writeFile(path.join(archive,'paper.json'),before)
 ;(p.source.repairs??=[]).push({method:'preserve-formal-chess-notation-and-clear-compiler-warning',recipeSha256:sha256(recipeBytes),review:spec.review,sourceHtmlSha256:p.source.sha256,tool:'preserve-rl-html-notation.mjs',toolVersion:'1.0.0',toolSha256:sha256(await readFile(new URL(import.meta.url))),changedBlocks:changes,at:new Date().toISOString(),translationPolicy:'Changed blocks reset; formal notation code remains byte-identical in both languages; prose requires exact-source response replay or new translation.'})
 p.translation.status='pending';p.translation.coverage={complete:p.blocks.filter(b=>b.zh).length,total:p.blocks.length};delete p.translation.completedAt
 await writeFile(file+'.notation-tmp',JSON.stringify(p,null,2)+'\n');await rename(file+'.notation-tmp',file);await updateCatalog(data,p);console.log(JSON.stringify({id:p.id,changedBlocks:changes.length,literalRegions:changes.reduce((n,c)=>n+c.literals.length,0)}))
})
