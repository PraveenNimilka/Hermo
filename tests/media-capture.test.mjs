import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {captureMediaDocument} from '../companion/browser/media-capture.mjs';

test('page-local capture reads only the selected loaded raster image and never fetches an HTTP target',async t=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});t.after(()=>browser.close());
  const page=await browser.newPage();await page.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<main><img id="result" width="240" height="160"></main>'}));await page.goto('https://example.com/');
  const expected=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;canvas.getContext('2d').fillRect(0,0,240,160);const blob=await new Promise(done=>canvas.toBlob(done,'image/png')),url=URL.createObjectURL(blob),image=document.querySelector('img');image.src=url;await image.decode();return url;});
  const command={origin:'https://example.com',selector:'#result',expected};
  const captured=await page.evaluate(captureMediaDocument,command);assert.equal(captured.mime,'image/png');assert.deepEqual([...Buffer.from(captured.data,'base64').subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal((await page.evaluate(captureMediaDocument,{...command,origin:'https://other.example'})).hermo_error,'ORIGIN_CHANGED');
  assert.equal((await page.evaluate(captureMediaDocument,{...command,expected:'blob:https://example.com/another-image'})).hermo_error,'ELEMENT_CHANGED');
  await page.evaluate(()=>{globalThis.httpFetches=0;const native=fetch;globalThis.fetch=(url,...args)=>{if(String(url).startsWith('https:'))globalThis.httpFetches++;return native(url,...args);};});
  await page.locator('img').evaluate(image=>{image.src='https://example.com/secret';});
  assert.equal((await page.evaluate(captureMediaDocument,{...command,expected:'https://example.com/secret'})).hermo_error,'ELEMENT_CHANGED');
  assert.equal(await page.evaluate(()=>globalThis.httpFetches),0);
});

test('page-local capture rejects active image formats and oversized images',async t=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('https://example.com/',route=>route.fulfill({contentType:'text/html',body:'<img id="result" width="240" height="160">'}));await page.goto('https://example.com/');
  const svg=await page.evaluate(async()=>{const image=document.querySelector('img'),url=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"></svg>'],{type:'image/svg+xml'}));image.src=url;await image.decode();return url;});
  assert.equal((await page.evaluate(captureMediaDocument,{origin:'https://example.com',selector:'#result',expected:svg})).hermo_error,'MEDIA_UNSUPPORTED');
  const large=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;const png=await new Promise(done=>canvas.toBlob(done,'image/png')),url=URL.createObjectURL(new Blob([png,new Uint8Array(8388608)],{type:'image/png'})),image=document.querySelector('img');image.src=url;await image.decode();return url;});
  assert.equal((await page.evaluate(captureMediaDocument,{origin:'https://example.com',selector:'#result',expected:large})).hermo_error,'MEDIA_TOO_LARGE');
});
