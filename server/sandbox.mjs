import { randomBytes } from 'node:crypto';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const css=`*{box-sizing:border-box}body{font:15px system-ui;color:#202624;background:#f4f7f5;margin:0}header{padding:24px 42px;display:flex;justify-content:space-between;background:white;border-bottom:1px solid #dde5df}main{max-width:850px;margin:55px auto;padding:0 26px}.logo{font-size:22px;font-weight:650;color:#1f5649}.tag{font-size:11px;border:1px solid #dce7df;border-radius:20px;padding:5px 10px;color:#527466}h1{font-size:34px;font-weight:550;letter-spacing:-1.3px}p{color:#68756e;line-height:1.7}.card{background:white;border:1px solid #e2e9e5;border-radius:16px;padding:28px;margin-top:24px}label{display:block;font-size:13px;margin:16px 0 7px}input{font:inherit;width:100%;border:1px solid #ccd8d0;border-radius:9px;padding:12px;background:#fbfdfb}button{font:inherit;background:#244b40;color:white;border:0;border-radius:9px;padding:12px 20px;cursor:pointer;margin-top:16px}.row{display:flex;gap:16px;align-items:end}.row>div{flex:1}.row button{height:44px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:20px}.label{font-size:12px;color:#6e7b73}dd{font-size:20px;margin:6px 0 0}dt{font-size:12px;color:#68776d}a{color:#395e4b}small{color:#7e8c82}`;
const page=(body,account=false)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Northstar · Hermo sandbox</title><link rel="stylesheet" href="/sandbox/style.css"></head><body><header><div class="logo">◈ Northstar</div>${account?'<div data-testid="account-identity">Alex Morgan · Northstar Supplies</div>':'<span class="tag">Synthetic demo portal</span>'}</header><main>${body}</main></body></html>`;
export function installSandbox(app) {
  const sessions=new Map(), nonces=new Set();
  app.get('/sandbox/style.css',async(_,reply)=>reply.type('text/css').send(css));
  app.get('/sandbox/',async(req,reply)=>{
    if(sessions.has(req.cookies.hermo_demo)) return reply.redirect('/sandbox/orders');
    const nonce=randomBytes(20).toString('hex');nonces.add(nonce);if(nonces.size>1000)nonces.delete(nonces.values().next().value);
    return reply.type('text/html').send(page(`<h1>A little space to try things.</h1><p>This is a local practice portal. Every account and order is synthetic.</p><div class="card"><form method="post" action="/sandbox/login"><input type="hidden" name="csrf" value="${nonce}"><label for="email">Email</label><input id="email" type="email" name="email" autocomplete="off" required><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="off" required><button type="submit">Sign in</button></form><p><small>Try alex@northstar.example / demo-only-local</small></p></div>`));
  });
  app.post('/sandbox/login',async(req,reply)=>{
    const fields=new URLSearchParams(typeof req.body==='string'?req.body:'');
    const nonce=fields.get('csrf');
    if(!nonces.delete(nonce)||fields.get('email')!=='alex@northstar.example'||fields.get('password')!=='demo-only-local') return reply.code(401).type('text/html').send(page('<h1>Sign-in did not complete.</h1><p>Use the synthetic credentials shown on the login page.</p><a href="/sandbox/">Try again</a>'));
    const token=randomBytes(24).toString('hex');sessions.set(token,Date.now());
    reply.setCookie('hermo_demo',token,{path:'/sandbox',httpOnly:true,sameSite:'strict',maxAge:3600});return reply.redirect('/sandbox/orders');
  });
  app.get('/sandbox/orders',async(req,reply)=>{
    const session=sessions.get(req.cookies.hermo_demo);
    if(!session||Date.now()-session>3600000){sessions.delete(req.cookies.hermo_demo);return reply.redirect('/sandbox/');}
    const orders={'ORD-2041':{status:'Shipped',customer:'Juniper Studio',total:'$248.00'},'ORD-2042':{status:'Processing',customer:'Oak & Coast',total:'$96.50'},'ORD-2043':{status:'Delivered',customer:'Fieldwork',total:'$420.00'}};
    const query=String(req.query.order_id??'').slice(0,128),order=orders[query];
    const result=query?(order?`<div class="card" data-testid="order-detail"><div class="fields"><div><dt>Order ID</dt><dd data-testid="order-id">${escape(query)}</dd></div><div><dt>Status</dt><dd data-testid="order-status">${order.status}</dd></div><div><dt>Customer</dt><dd data-testid="order-customer">${order.customer}</dd></div><div><dt>Total</dt><dd data-testid="order-total">${order.total}</dd></div></div></div>`:`<div class="card" data-testid="no-match">No order found for ${escape(query)}.</div>`):'';
    return reply.type('text/html').send(page(`<span class="tag">Orders</span><h1>Find an order.</h1><p>A simple task. Ready to become an API.</p><div class="card"><form method="get" action="/sandbox/orders" class="row"><div><label for="order-id">Order ID</label><input id="order-id" name="order_id" placeholder="ORD-2041" value="${escape(query)}" autocomplete="off" required></div><button type="submit">Search orders</button></form></div>${result}<button type="button" disabled data-testid="unavailable-control">Unavailable demo control</button><p><small>Available IDs: ORD-2041, ORD-2042, ORD-2043. Other IDs return no match.</small></p>`,true));
  });
  return {expireAll(){sessions.clear();}};
}
