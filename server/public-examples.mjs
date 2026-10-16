import {installExamples} from './examples.mjs';

// Real, externally hosted websites explicitly offered by their operator for
// scraping and automation practice. They contain demonstration data.
export const publicApps=[
  {id:'books',name:'Books to Scrape',url:'https://books.toscrape.com/',template:'https://books.toscrape.com/catalogue/{book}/index.html',parameter:'book',samples:['a-light-in-the-attic_1000','tipping-the-velvet_999'],fields:[{name:'title',values:['A Light in the Attic','Tipping the Velvet']},{name:'price',values:['£51.77','£53.74']},{name:'upc',values:['a897fe39b1053632','90fa61229261140a']}]},
  {id:'authors',name:'Quotes to Scrape',url:'https://quotes.toscrape.com/',template:'https://quotes.toscrape.com/author/{author}/',parameter:'author',samples:['Albert-Einstein','J-K-Rowling'],fields:[{name:'name',values:['Albert Einstein','J.K. Rowling']},{name:'born',values:['March 14, 1879','July 31, 1965']}]}
];
export function installPublicExamples(app,options){installExamples(app,options,{specs:publicApps,prefix:'/studio/public-examples',setting:'public_example_catalog'});}
