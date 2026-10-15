import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cultureDetailMarkup, cultureDetailPath} from '../../src/lib/culture-view.js';

const ui={escape:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),icon:()=>'<svg></svg>'};

test('culture detail is page content with text, image, music and an in-portal back action',()=>{
  const markup=cultureDetailMarkup(ui,{id:'x1',name:'Oxum',alias:'Ọ̀ṣun',description:'Texto\nritual',imageUrl:'https://img.example/oxum.jpg'},'Itáns e Orixás','https://open.spotify.com/embed/track/0123456789012345678901',true);
  assert.match(markup,/class="culture-page culture-entry-page"/);
  assert.match(markup,/<h1[^>]*>Oxum<\/h1>/);
  assert.match(markup,/https:\/\/img\.example\/oxum\.jpg/);
  assert.match(markup,/Spotify: Oxum/);
  assert.match(markup,/data-culture-back/);
  assert.match(markup,/data-culture-edit/);
  assert.doesNotMatch(markup,/<dialog/);
});

test('culture detail route keeps collection context and safely encodes the item id',()=>{
  assert.equal(cultureDetailPath('members','a/b'),'members/a%2Fb');
});
