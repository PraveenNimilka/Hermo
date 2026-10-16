import test from 'node:test';
import assert from 'node:assert/strict';
import {pageTemplate,pageParameter} from '../server/page-template.mjs';
test('page parameters cannot escape a complete path segment or claim a different record',()=>{
  const template='https://books.toscrape.com/catalogue/{book}/index.html';
  assert.equal(pageTemplate(template,'book','a-light_1000').url,'https://books.toscrape.com/catalogue/a-light_1000/index.html');
  assert.equal(pageParameter('https://books.toscrape.com/catalogue/a-light_1000/index.html',template,'book'),'a-light_1000');
  for(const value of ['../secret','..','%2f','x/y','?redirect=x','https://other.example','x#fragment','x\ny',''])assert.throws(()=>pageTemplate(template,'book',value));
  for(const invalid of ['https://{book}.example/path/','https://site.example/prefix{book}/','https://site.example/{book}?q=1','https://user:pass@site.example/{book}/','http://site.example/{book}/','https://site.example:9000/{book}/','https://site.example/{book}/{book}/'])assert.throws(()=>pageTemplate(invalid,'book','safe'));
  assert.throws(()=>pageParameter('https://other.example/catalogue/a-light_1000/index.html',template,'book'));assert.throws(()=>pageParameter('https://books.toscrape.com/catalogue/a%2Flight/index.html',template,'book'));
});
