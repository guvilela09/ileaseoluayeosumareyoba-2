const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function inline(text,attributes){
  const a=attributes&&typeof attributes==='object'&&!Array.isArray(attributes)?attributes:{};
  const styles=[];
  if(a.font==='serif')styles.push('font-family:var(--serif)');
  if(a.font==='sans'||a.font==='sans-serif')styles.push('font-family:var(--sans)');
  if(/^(14|16|18|20|24|32)px$/.test(a.size||''))styles.push(`font-size:${a.size}`);
  if(/^#[0-9a-f]{6}$/i.test(a.color||''))styles.push(`color:${a.color}`);
  let html=escape(text);
  if(a.bold===true)html=`<strong>${html}</strong>`;
  if(a.italic===true)html=`<em>${html}</em>`;
  if(a.underline===true)html=`<u>${html}</u>`;
  return styles.length||Object.keys(a).length?`<span${styles.length?` style="${styles.join(';')}"`:''}>${html}</span>`:html;
}

export function deltaToHTML(delta){
  if(!Array.isArray(delta?.ops))return '';
  const blocks=[];let line='',listType=null,listItems=[];
  const flushList=()=>{if(listType){blocks.push(`<${listType}>${listItems.join('')}</${listType}>`);listType=null;listItems=[];}};
  for(const op of delta.ops){
    if(typeof op?.insert!=='string')continue;
    for(const piece of op.insert.split(/(\n)/)){
      if(!piece)continue;
      if(piece==='\n'){
        const type=op.attributes?.list==='bullet'?'ul':op.attributes?.list==='ordered'?'ol':null;
        if(type){if(listType!==type){flushList();listType=type;}listItems.push(`<li>${line||'<br>'}</li>`);}
        else{flushList();blocks.push(`<p>${line||'<br>'}</p>`);}
        line='';
      }else line+=inline(piece,op.attributes);
    }
  }
  flushList();if(line)blocks.push(`<p>${line}</p>`);
  return blocks.join('');
}
