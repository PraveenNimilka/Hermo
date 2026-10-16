import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {renderPanel} from '../companion/browser/panel.mjs';

// This exercises the actual packaged extension in Chrome. The local website
// fixture checks interface states, not external-site workflow compatibility.
test('companion branding, popup permission form, and manual pages remain usable in Chrome', {timeout: 60000}, async () => {
  const server = createServer((_, reply) => {
    reply.writeHead(200, {'content-type': 'text/html'});
    reply.end('<!doctype html><title>Companion interface test</title><main><h1>Local interface fixture</h1></main>');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let context;
  const evidence = resolve('work/companion-ui', randomUUID());
  await mkdir(evidence, {recursive: true});
  try {
    context = await chromium.launchPersistentContext('', {
      headless: true, chromiumSandbox: true,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'],
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('companion/browser')});
    let nextMessage = 1;
    const request = async (targetId, method, params = {}) => {
      const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten: false});
      try {
        return await new Promise((done, reject) => {
          const messageId = nextMessage++;
          const listener = event => {
            if (event.sessionId !== sessionId) return;
            const result = JSON.parse(event.message);
            if (result.id !== messageId) return;
            clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', listener);
            if (result.error || result.result?.exceptionDetails) reject(Error(JSON.stringify(result)));
            else done(result.result);
          };
          const timer = setTimeout(() => {cdp.off('Target.receivedMessageFromTarget', listener); reject(Error('Companion UI evaluation timed out'));}, 10000);
          cdp.on('Target.receivedMessageFromTarget', listener);
          cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id: messageId, method, params})}).catch(reject);
        });
      } finally {await cdp.send('Target.detachFromTarget', {sessionId}).catch(() => {});}
    };
    const evaluate = async (targetId, expression) => (await request(targetId, 'Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true})).result.value;
    const site = await context.newPage(); await site.goto(origin);
    const selected = (await cdp.send('Target.getTargets', {filter: [{type:'tab', exclude:false}, {exclude:true}]})).targetInfos.find(target => target.url === site.url());
    assert.ok(selected);
    await cdp.send('Extensions.triggerAction', {id, targetId: selected.targetId});
    let popup;
    for (let attempt = 0; attempt < 60; attempt++) {
      popup = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url.endsWith('/popup.html'));
      if (popup && await evaluate(popup.targetId, "document.documentElement.dataset.hermoReady==='true'").catch(() => false)) break;
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(popup, 'Chrome opens the actual extension popup');
    const layout = await evaluate(popup.targetId, `(() => {
      const box = selector => {const {x,y,width,height,bottom} = document.querySelector(selector).getBoundingClientRect(); return {x,y,width,height,bottom};};
      const image = document.querySelector('.companion-brand img');
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,logoLoaded:image.complete&&image.naturalWidth>0,
        form:box('#pair'),code:box('#code'),submit:box('#connect'),website:document.querySelector('#website').textContent,
        codeType:document.querySelector('#code').type,labels:['workspace','code','authorize'].map(id=>document.getElementById(id).labels.length),
        previewDisabled:document.querySelector('#preview-enable').disabled,hiddenPreviewStop:document.querySelector('#preview-stop').hidden,
        primaryColor:getComputedStyle(document.querySelector('#connect')).backgroundColor,liveRegion:document.querySelector('#status').getAttribute('role')};
    })()`);
    assert.equal(layout.logoLoaded, true);
    assert.match(layout.website, new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(layout.scrollWidth <= layout.width, 'popup does not overflow horizontally');
    assert.ok(Math.abs(layout.code.x - layout.submit.x) < 1);
    assert.ok(Math.abs(layout.code.width - layout.submit.width) < 1);
    assert.ok(layout.submit.height >= 44);
    assert.ok(layout.submit.bottom <= Math.min(600,layout.height), 'primary connect action is available before scrolling a normal Chrome popup: '+JSON.stringify(layout));
    assert.deepEqual(layout.labels, [1,1,1]);
    assert.equal(layout.codeType, 'password');
    assert.equal(layout.previewDisabled, true); assert.equal(layout.hiddenPreviewStop, true);
    assert.equal(layout.primaryColor, 'rgb(32, 32, 32)'); assert.equal(layout.liveRegion, 'status');
    await evaluate(popup.targetId, "document.querySelector('#code').focus();true");
    const key = async (name, code, windowsVirtualKeyCode) => {
      await request(popup.targetId, 'Input.dispatchKeyEvent', {type:'keyDown', key:name, code, windowsVirtualKeyCode, ...name==='Enter'?{text:'\r'}:{}});
      await request(popup.targetId, 'Input.dispatchKeyEvent', {type:'keyUp', key:name, code, windowsVirtualKeyCode});
    };
    await key('Tab','Tab',9);
    assert.equal(await evaluate(popup.targetId, "document.activeElement===document.querySelector('.runtime-settings summary')"), true);
    assert.equal(await evaluate(popup.targetId, "getComputedStyle(document.activeElement).outlineStyle"), 'solid');
    await key('Enter','Enter',13);
    assert.equal(await evaluate(popup.targetId, "document.querySelector('.runtime-settings').open"), true);
    await key('Enter','Enter',13);
    assert.equal(await evaluate(popup.targetId, "document.querySelector('.runtime-settings').open"), false);
    await evaluate(popup.targetId, 'window.scrollTo(0,0);document.activeElement.blur();true');
    const initialCapture = await request(popup.targetId, 'Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
    await writeFile(resolve(evidence, 'popup-connect.png'), Buffer.from(initialCapture.data, 'base64'));
    await evaluate(popup.targetId, "document.querySelector('#code').value='invalid-test-code';document.querySelector('#authorize').checked=true;document.querySelector('#pair').requestSubmit();true");
    const failure = await evaluate(popup.targetId, "document.querySelector('#status').textContent");
    assert.match(failure, /fresh pairing code/);
    assert.doesNotMatch(failure, /invalid-test-code/);
    await evaluate(popup.targetId, "document.querySelector('#code').value='';true");
    // Native Chrome popups have a 600px viewport; capture only that surface.
    // Beyond-viewport screenshots can repeat composited popup contents.
    const capture = await request(popup.targetId, 'Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
    await writeFile(resolve(evidence, 'popup-validation-error.png'), Buffer.from(capture.data, 'base64'));
    await evaluate(popup.targetId, "document.querySelector('#live-preview').scrollIntoView({block:'start'});true");
    const previewCapture = await request(popup.targetId, 'Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
    await writeFile(resolve(evidence, 'popup-preview-permission.png'), Buffer.from(previewCapture.data, 'base64'));
    await cdp.send('Target.closeTarget', {targetId: popup.targetId});

    const manual = await context.newPage();
    for (const pageName of ['connect.html', 'controller.html']) {
      await manual.goto(`chrome-extension://${id}/${pageName}`);
      await manual.waitForFunction(() => document.querySelector('#website').textContent !== 'Checking website…');
      for (const width of [375,768,1440]) {
        await manual.setViewportSize({width, height: 900});
        const dimensions = await manual.evaluate(() => ({width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
          margin:document.querySelector('main').getBoundingClientRect().x,
          logoLoaded:document.querySelector('.companion-brand img').naturalWidth>0}));
        assert.ok(dimensions.scrollWidth <= dimensions.width, `${pageName} fits at ${width}px`);
        assert.equal(dimensions.logoLoaded, true);
        if (width === 1440) assert.ok(Math.abs(dimensions.margin - (1440 - 600) / 2) < 1, 'manual page is centered');
        await manual.screenshot({path:resolve(evidence, `${pageName.replace('.html','')}-${width}.png`),fullPage:true});
      }
    }
    const manifest = JSON.parse(await readFile('companion/browser/manifest.json', 'utf8'));
    assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
    assert.equal(manifest.icons['128'], 'hermo-crab.png');
    const targets = (await cdp.send('Target.getTargets')).targetInfos;
    assert.equal(targets.some(target => target.url.endsWith('/preview-offscreen.html')), false, 'opening the UI never authorizes screen capture');
    await site.evaluate(renderPanel, {state:'ready',name:'Local interface fixture',controller:'ui-test',generation:1});
    const panel = () => site.evaluate(() => {
      const root = document.querySelector('#hermo-connection-panel').__hermoView.root;
      return {expanded:root.querySelector('.collapse').getAttribute('aria-expanded'),hidden:root.querySelector('.body').hidden};
    });
    assert.deepEqual(await panel(), {expanded:'true',hidden:false});
    await site.evaluate(() => document.querySelector('#hermo-connection-panel').__hermoView.root.querySelector('.collapse').click());
    assert.deepEqual(await panel(), {expanded:'false',hidden:true});
    await site.evaluate(() => document.querySelector('#hermo-connection-panel').__hermoView.root.querySelector('.collapse').click());
    assert.deepEqual(await panel(), {expanded:'true',hidden:false});
  } finally {
    await context?.close(); await new Promise(done => server.close(done));
  }
});
