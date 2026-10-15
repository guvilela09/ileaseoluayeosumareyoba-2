import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deltaToHTML} from '../../src/lib/rich.js';

test('texto enviado como HTML permanece texto e não cria elementos executáveis',()=>{
  const html=deltaToHTML({ops:[{insert:'<img src=x onerror="alert(1)">\n'}]});
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
});
test('lista Quill usa marcadores sem perder o texto de cada item',()=>{
  const html=deltaToHTML({ops:[{insert:'Primeiro'},{insert:'\n',attributes:{list:'bullet'}},{insert:'Segundo'},{insert:'\n',attributes:{list:'bullet'}}]});
  assert.equal(html,'<ul><li>Primeiro</li><li>Segundo</li></ul>');
});
test('lista numerada encerra antes do próximo parágrafo',()=>{
  const html=deltaToHTML({ops:[{insert:'Item'},{insert:'\n',attributes:{list:'ordered'}},{insert:'Mensagem final\n'}]});
  assert.equal(html,'<ol><li>Item</li></ol><p>Mensagem final</p>');
});
test('atributos maliciosos e embeds não entram no documento',()=>{
  const html=deltaToHTML({ops:[{insert:{image:'javascript:alert(1)'}},{insert:'Olá',attributes:{color:'#000000;position:fixed',font:'serif;url(javascript:evil)',onclick:'evil'}},{insert:'\n'}]});
  assert.equal(html,'<p><span>Olá</span></p>');
});
test('fontes, cor e tamanhos autorizados permanecem legíveis',()=>{
  const html=deltaToHTML({ops:[{insert:'A casa',attributes:{font:'serif',size:'20px',color:'#a74517',bold:true}},{insert:'\n'}]});
  assert.ok(html.includes('font-size:20px'));
  assert.ok(html.includes('color:#a74517'));
  assert.ok(html.includes('<strong>A casa</strong>'));
});
