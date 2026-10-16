import {build} from 'esbuild';
import {recordedPaths} from './recorded-chat-layout.mjs';

// Owned fixture with a real ProseMirror document model, deep DOM and streamed
// multi-paragraph replies. It never contacts an AI provider or personal account.
export async function richChatFixture({legacy=false,deepLegacy=false,recordedLegacy=false,recordedFlat=false}={}){
  const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',stdin:{resolveDir:process.cwd(),contents:String.raw`
    import {Schema} from 'prosemirror-model';
    import {EditorState} from 'prosemirror-state';
    import {EditorView} from 'prosemirror-view';
    const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*',parseDOM:[{tag:'p'}],toDOM:()=>['p',0]},text:{inline:true}}});
    const button=document.querySelector('#send'),messages=document.querySelector('#messages');
    const view=new EditorView(document.querySelector('#editor'),{state:EditorState.create({schema}),attributes:{'aria-label':'Ask Chat','data-placeholder':'Message'},dispatchTransaction(transaction){view.updateState(view.state.apply(transaction));window.fixtureModel=view.state.doc.textBetween(0,view.state.doc.content.size,'\n');button.disabled=!window.fixtureModel;}});
    window.fixtureModel='';let count=0;
    const paths=window.fixtureRecordedPaths,userPath=paths?.prompt_echo.split(' > '),replyPath=paths?.response.split(' > ');let split=0;
    if(paths)while(userPath[split]===replyPath[split])split++;
    const follow=(root,parts)=>{let node=root;for(const part of parts){const [,tag,n]=part.match(/^(\w+):nth-of-type\((\d+)\)$/);while([...node.children].filter(x=>x.tagName.toLowerCase()===tag).length<Number(n))node.append(document.createElement(tag));node=[...node.children].filter(x=>x.tagName.toLowerCase()===tag)[Number(n)-1];}return node;};
    const prefix=paths?follow(messages,userPath.slice(1,window.fixtureRecordedFlat?split:split-1)):undefined;
    button.addEventListener('click',()=>{
      const prompt=window.fixtureTrimPrompt?window.fixtureModel.trim():window.fixtureModel;if(!prompt)return;count++;window.fixtureSendCount=count;
      const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=prompt;
      let reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');reply.setAttribute('aria-busy','true');
      let replyTurn;if(paths){const pair=document.createElement('div');if(window.fixtureRecordedFlat){const submitted=document.createElement('div');prefix.append(submitted,pair);follow(submitted,userPath.slice(split+1)).textContent=prompt;reply=follow(pair,replyPath.slice(split+1,-1));}else{prefix.append(pair);follow(pair,userPath.slice(split)).textContent=prompt;reply=follow(pair,replyPath.slice(split,-1));}reply.setAttribute('aria-busy','true');pair.insertAdjacentHTML('beforeend','<div><button><svg></svg></button><button><svg></svg></button></div>');}
      else if(window.fixtureLegacy){user.removeAttribute('data-message-author-role');reply.removeAttribute('data-message-author-role');const pair=document.createElement('div');pair.append(user);replyTurn=document.createElement('div');replyTurn.append(reply);pair.append(replyTurn);messages.append(pair);if(window.fixtureDeepLegacy){const copy=document.createElement('button');copy.setAttribute('aria-label','Copy message');copy.textContent='Copy';user.append(copy);let wrapped=replyTurn;for(let i=0;i<65;i++){const box=document.createElement('div');wrapped.replaceWith(box);box.append(wrapped);wrapped=box;}}}else{messages.append(user,reply);}
      const stop=document.createElement('button');stop.setAttribute('aria-label','Stop generating');stop.textContent='Stop';messages.append(stop);
      if(count===1)history.pushState({},'', '/chat/1');
      view.dispatch(view.state.tr.delete(0,view.state.doc.content.size));
      setTimeout(()=>{reply.innerHTML='<p>Partial response</p>';},250);
      setTimeout(()=>{const p=document.createElement('p');p.textContent='Answer for '+prompt;const q=document.createElement('p');q.append('Ready ',Object.assign(document.createElement('strong'),{textContent:'to use'}),'.');reply.replaceChildren(p,q);reply.removeAttribute('aria-busy');stop.remove();if(replyTurn){const toolbar=document.createElement('div');toolbar.innerHTML='<button aria-label="Copy">Copy</button><button aria-label="Good response">Like</button>';if(window.fixtureDeepLegacy)reply.replaceWith(p,q);replyTurn.append(toolbar);}},1400);
    });
  `}});
  return '<!doctype html><title>Owned rich chat</title><style>.ProseMirror{min-height:60px;border:1px solid #aaa;padding:10px;white-space:pre-wrap}button{min-height:25px}p{min-height:18px}</style><h1 id="account">Synthetic external account</h1><div id="messages" aria-label="Conversation">'+(legacy||recordedLegacy?'':'<div data-message-author-role="user">Older prompt</div><div data-message-author-role="assistant"><p>Older response</p></div>')+'</div>'+'<div>'.repeat(45)+'<div id="editor"></div><button id="send" aria-label="Send message" disabled>Send</button>'+'</div>'.repeat(45)+'<script>window.fixtureLegacy='+JSON.stringify(legacy)+';window.fixtureDeepLegacy='+JSON.stringify(deepLegacy)+';window.fixtureRecordedFlat='+JSON.stringify(recordedFlat)+';window.fixtureRecordedPaths='+JSON.stringify(recordedLegacy?recordedPaths:null)+';'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>';
}
