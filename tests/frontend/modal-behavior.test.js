import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindModalCloseControls,followVisualViewport} from '../../src/lib/modal-behavior.js';

test('modal stays open on backdrop and Escape, and closes only from its explicit close control',()=>{
  const dialog=new EventTarget();
  const closeButton=new EventTarget();
  dialog.querySelectorAll=selector=>selector==='[data-modal-close]'?[closeButton]:[];
  let closed=0;
  bindModalCloseControls(dialog,()=>closed++);

  dialog.dispatchEvent(new Event('click'));
  const cancel=new Event('cancel',{cancelable:true});
  dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented,true);
  assert.equal(closed,0);

  closeButton.dispatchEvent(new Event('click'));
  assert.equal(closed,1);
});

test('modal close control stays disabled during submission',()=>{
  const dialog=new EventTarget();
  const closeButton=new EventTarget();
  dialog.querySelectorAll=()=>[closeButton];
  let closed=0;
  bindModalCloseControls(dialog,()=>closed++,()=>true);
  closeButton.dispatchEvent(new Event('click'));
  assert.equal(closed,0);
});

test('mobile modal tracks the visible viewport and removes listeners when closed',()=>{
  const values=new Map();
  const element={style:{setProperty:(key,value)=>values.set(key,value)}};
  const viewport=new EventTarget();
  viewport.height=640;
  viewport.offsetTop=0;
  const dispose=followVisualViewport(element,viewport);
  assert.equal(values.get('--modal-viewport-height'),'640px');
  assert.equal(values.get('--modal-viewport-offset-top'),'0px');

  viewport.height=360;
  viewport.offsetTop=120;
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(values.get('--modal-viewport-height'),'360px');
  assert.equal(values.get('--modal-viewport-offset-top'),'120px');
  dispose();
  viewport.height=300;
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(values.get('--modal-viewport-height'),'360px');
});
