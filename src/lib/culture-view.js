const safe=(ui,value)=>ui.escape(String(value??''));

function imageMarkup(ui,item,label){
  if(item?.imageUrl){
    try{
      const url=new URL(item.imageUrl,globalThis.location?.origin||'https://portal.invalid');
      if(['https:','http:'].includes(url.protocol))return `<img src="${safe(ui,url.href)}" alt="${safe(ui,item.name||label)}" loading="lazy">`;
    }catch{}
  }
  return '<div class="culture-image-empty" aria-label="Imagem aguardando envio pela casa"><span aria-hidden="true">✦</span><small>Imagem em preparação</small></div>';
}

export function cultureDetailPath(collection,id){return `${collection}/${encodeURIComponent(String(id))}`;}

export function cultureDetailMarkup(ui,item,label,embed,isAdmin){
  return `<section class="culture-page culture-entry-page"><button class="btn btn-secondary culture-back" type="button" data-culture-back>${ui.icon('arrow')} Voltar para ${safe(ui,label)}</button><header class="page-heading culture-heading"><div><p class="page-kicker">${safe(ui,label)}</p><h1 class="page-title">${safe(ui,item.name)}</h1>${item.alias?`<p class="culture-alias">${safe(ui,item.alias)}</p>`:''}</div>${isAdmin?`<button class="btn btn-secondary" type="button" data-culture-edit>${ui.icon('edit')} Editar</button>`:''}</header><div class="culture-entry-layout"><div class="culture-detail-image">${imageMarkup(ui,item,label)}</div><div class="culture-description">${item.description?safe(ui,item.description).replace(/\r?\n/g,'<br>'):'<p class="culture-pending">Descrição aguardando conteúdo da casa.</p>'}</div>${embed?`<section class="culture-music"><h2>Música</h2><button class="btn btn-secondary culture-play" type="button">${ui.icon('music')} Reproduzir música</button><p class="culture-play-status" aria-live="polite">Se a reprodução não iniciar, use os controles do Spotify abaixo.</p><div class="culture-player"><iframe title="Spotify: ${safe(ui,item.name)}" src="${safe(ui,embed)}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div></section>`:''}</div></section>`;
}
