// Exercise each independent consumer UI against the isolated live runtime.
// Pass only the private work/.../consumer-config.json produced by verify-real-world.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createConsumerHost,apps} from '../validation-apps/shared/host.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.match(resolve(process.argv[2]),/[\\/]work[\\/]real-world[\\/]/);
const timestamp=new Date().toISOString().replace(/[:.]/g,'-'),report={tested_at:new Date().toISOString(),kind:'live-consumer-UI',runtime:config.origin,applications:[]};
mkdirSync('validation/evidence',{recursive:true});
const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.HERMO_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const selected=process.argv[3]?apps.filter(app=>process.argv[3].split(',').includes(app)):apps;
  for(const [index,app]of selected.entries()){
    const item=config.items[['json-explorer','mcp-tools','website-dashboard'].includes(app)?'quotes':'products'];
    const host=createConsumerHost({app,runtime:config.origin,port:0});await host.listen();const address=`http://127.0.0.1:${host.server.address().port}`;
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),executions=new Map(),errors=[],responses=new Set();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{
      if(!response.url().endsWith('/api/request'))return;
      const pending=(async()=>{
      const value=await response.json().catch(()=>null);
      const candidates=[value,value?.result?.structuredContent];
      for(const run of candidates)if(run?.id&&['succeeded','failed','cancelled'].includes(run.status))executions.set(run.id,run);
      })();
      responses.add(pending);pending.finally(()=>responses.delete(pending));
    });
    try{
      await page.goto(address);await page.locator('#api-key').fill(item.key);
      await page.locator('#endpoint').fill(`/v1/actions/${item.slug}/versions/1/runs`);
      if(app==='simple-ai-chat'){
        await page.locator('#connect').click();await page.waitForFunction(()=>!document.querySelector('#message').disabled);
        await page.locator('#prompt-field').selectOption('category');await page.locator('#message').fill('travel_2');
        await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,{},{timeout:180000});
      }else{
      await page.locator('#load-contract').click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Published contract loaded'));
      if(app==='mcp-tools'){await page.locator('#discover-tools').click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('authorized tools discovered'));await page.locator('#tool-count').selectOption('2');}
      if(app==='reliability-lab'){await page.locator('#request-count').fill('2');await page.locator('#concurrency').selectOption('2');}
      await page.locator('#run').click();
      await page.waitForFunction(()=>!document.querySelector('#run').disabled,{},{timeout:180000});
      }
      // The UI and the observer consume response bodies independently.
      await Promise.all([...responses]);
      const resultSelector=app==='simple-ai-chat'?'#messages':'#result';
      assert.ok(executions.size>0,app+': no actual terminal API response; '+await page.locator(app==='simple-ai-chat'?'#run-status':'#status').textContent());
      const runs=[...executions.values()];assert.ok(runs.every(run=>run.status==='succeeded'&&run.result&&run.verification),JSON.stringify({app,runs}));
      if(app==='mcp-tools')assert.equal(runs.length,2,'Both concurrent MCP calls must produce actual verified runs');
      assert.equal(errors.length,0,JSON.stringify(errors));
      assert.ok((await page.locator(resultSelector).textContent()).includes('managed_local'));
      if(app==='change-detector'){
        await page.locator('#run').click();await page.waitForFunction(()=>!document.querySelector('#run').disabled,{},{timeout:120000});
        assert.match(await page.locator('#records').textContent(),/unchanged/i);
        const stored=await page.evaluate(()=>localStorage.getItem('hermo-consumer-observations-v1'));assert.ok(stored);assert.ok(!stored.includes('hm_live_'));
      }
      if(app==='json-explorer'||app==='website-dashboard'||app==='product-search')assert.ok(await page.locator('#records tbody tr').count()>0);
      if(await page.locator('#filter').count()){
        await page.locator('#filter').fill('NO-SUCH-ACCEPTANCE-RECORD-73921');
        assert.equal(await page.locator('#records tbody tr').count(),0);
        await page.locator('#filter').fill('');assert.ok(await page.locator('#records tbody tr').count()>0);
      }
      const exports=page.getByRole('button',{name:/^Export /});
      if(await exports.count()){
        const [download]=await Promise.all([page.waitForEvent('download'),exports.first().click()]);
        const exported=JSON.parse(readFileSync(await download.path(),'utf8'));
        assert.ok(!JSON.stringify(exported).includes('hm_live_'),'Export must never contain an API key');
        assert.ok(JSON.stringify(exported).includes('run_'),'Export must refer to actual observed runs');
      }
      await page.evaluate(()=>scrollTo(0,0));
      const desktop=`validation/evidence/${app}-desktop.png`;await page.screenshot({path:desktop});
      await page.setViewportSize({width:375,height:812});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),app+': horizontal overflow');
      await page.locator(resultSelector).scrollIntoViewIfNeeded();
      const mobile=`validation/evidence/${app}-mobile.png`;await page.screenshot({path:mobile});
      report.applications.push({app,status:'passed',runs:[...executions.values()].map(run=>({id:run.id,status:run.status,workflow_id:run.workflow_id,revision:run.workflow_revision,execution_mode:run.execution_mode,created_at:run.created_at,verification:run.verification,queue_duration_ms:run.queue_duration_ms,execution_ms:run.execution_ms,record_count:run.result.products?.length??run.result.quotes?.length})),screenshots:{desktop,mobile},page_errors:errors});
      console.log(app+' verified using actual '+item.slug+' API');
      writeFileSync('validation/results/consumer-ui-'+timestamp+'.json',JSON.stringify(report,null,2));
    }finally{await context.close();await new Promise(done=>host.server.close(done));}
  }
}catch(error){report.failure={message:error.message};process.exitCode=1;console.error(error);}finally{await browser.close();report.completed_at=new Date().toISOString();writeFileSync('validation/results/consumer-ui-'+timestamp+'.json',JSON.stringify(report,null,2));}
