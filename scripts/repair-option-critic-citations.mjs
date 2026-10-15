import {readFile,writeFile,rename,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {load} from 'cheerio'
import {sha256} from './paper-lib.mjs'
import {withExclusivePaperLock} from './catalog-lock.mjs'
import {updateCatalog} from './import-paper.mjs'
const args=process.argv.slice(2),arg=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw Error('Missing '+k);return args[i+1]}
const data=arg('--data'),reviewBytes=await readFile(arg('--review')),review=JSON.parse(reviewBytes)
if(review.model!=='gpt-6-luna'||review.reasoningEffort!=='low'||review.humanReviewed!==false)throw Error('Unexpected source review identity')
await withExclusivePaperLock(data,'option-critic',async()=>{
 const dir=path.join(data,'papers','option-critic'),file=path.join(dir,'paper.json'),before=await readFile(file),p=JSON.parse(before),source=await readFile(path.join(dir,'source.html'))
 if(sha256(source)!=='97844b0478492f8496f888c86a87c9958910221a9a3de0982660d16137a5d84e')throw Error('Pinned source changed')
 if(p.source.repairs?.some(r=>r.method==='restore-inline-author-year-citation-labels'))return
 const changes=[]
 for(const b of p.blocks.filter(b=>b.en.includes('\\citeauthoryear'))){const $=load(b.en,{},false),labels=[]
  for(const anchor of $('a[href^="#bib."]').toArray()){const a=$(anchor),text=a.text();if(!text.startsWith('\\citeauthoryear'))continue;if(a.children().length)throw Error('Unexpected nested citation structure');const label=text.replace(/^\\citeauthoryear/,'').replace(/\s+/g,' ').replace(/(?<=[\p{L}.])(?=(?:18|19|20)\d{2}[a-z]?$)/u,' ').trim();if(!/[\p{L}]\s+(?:18|19|20)\d{2}[a-z]?$/u.test(label)&&!/\.\s+(?:18|19|20)\d{2}[a-z]?$/.test(label))throw Error('Unexpected author-year label '+label);a.empty().append($('<span class="ltx_verbatim"></span>').text(label));labels.push({href:a.attr('href'),originalLabel:text,correctedLabel:label})}
  if(!labels.length||$.text().includes('\\citeauthoryear'))throw Error('Unmapped inline citation macro')
  const en=$.html();changes.push({blockId:b.id,sourceId:b.sourceId,previousSha256:sha256(b.en),correctedSha256:sha256(en),labels});b.en=en;b.zh=null;delete b.translation
 }
 if(!changes.length)throw Error('Expected inline citation defects')
 const archive=path.join(data,'..','archive','option-critic-before-inline-citations-'+Date.now());await mkdir(archive,{recursive:true});await writeFile(path.join(archive,'paper.json'),before)
 ;(p.source.repairs??=[]).push({method:'restore-inline-author-year-citation-labels',originalHtmlSha256:sha256(source),sourcePdfSha256:'d8089c6012c607f3a9e8b560290dea629c91b174e246e18864ac6615467e208f',sourcePdfUrl:'https://arxiv.org/pdf/1609.05140v2',review:{model:'gpt-6-luna',reasoningEffort:'low',humanReviewed:false,reportSha256:sha256(reviewBytes),scope:'PDF pages 1–2 sampled citation labels; deterministic prefix removal, author/year separation and exact original anchor preservation applied to all matching labels.'},changedBlocks:changes,tool:'repair-option-critic-citations.mjs',version:'1.0.0',toolSha256:sha256(await readFile(new URL(import.meta.url))),translationPolicy:'Author-year citation labels frozen as original bibliographic metadata; affected prose blocks reset for exact-source response replay and retranslation.',at:new Date().toISOString()})
 p.translation.status='pending';p.translation.coverage={complete:p.blocks.filter(b=>b.zh).length,total:p.blocks.length};delete p.translation.completedAt;await writeFile(file+'.citations-tmp',JSON.stringify(p,null,2)+'\n');await rename(file+'.citations-tmp',file);await updateCatalog(data,p);console.log({blocks:changes.length,citations:changes.reduce((n,c)=>n+c.labels.length,0)})
})
