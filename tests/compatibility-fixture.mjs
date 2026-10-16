const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installCompatibilityFixture(app) {
  const page=(reply,body)=>reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self' https://assets.example.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://assets.example.com https://auth.openai.com; frame-src 'self'; frame-ancestors 'self'; form-action 'self'").type('text/html').send('<!doctype html><html><head><title>Compatibility lab</title></head><body style="font-family:system-ui;padding:20px">'+body+'</body></html>');
  app.get('/sandbox/compat',(_,reply)=>page(reply,'<p id="account">Compatibility test account</p><div id="hydration"></div><script src="/sandbox/compat.js"></script>'));
  app.get('/sandbox/compat.js',(_,reply)=>reply.type('application/javascript').send(`setTimeout(()=>{
    document.querySelector('#hydration').innerHTML='<h1>Browser compatibility lab</h1><div id="editor" contenteditable="true" role="textbox" aria-label="Rich editor" style="border:1px solid;padding:12px">Edit me</div><div id="shadow-host"></div><iframe id="embedded" title="Lookup frame" src="/sandbox/compat-frame" style="width:700px;height:230px"></iframe><a target="_blank" href="/sandbox/compat-popup">Open login popup</a><button id="role" role="button">Role action</button><div style="height:1200px">Scrollable page</div>';
    document.querySelector('#editor').style.cssText='position:absolute;left:28px;top:90px;width:600px;height:30px;border:1px solid;padding:12px';
    const echo=document.createElement('p');echo.id='manual-result';document.body.append(echo);document.querySelector('#editor').addEventListener('input',e=>echo.textContent=e.target.textContent);
    document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<input aria-label="Shadow input" id="shadow-input"><p id="shadow-output">Shadow result</p>';
  },800);`));
  app.get('/sandbox/compat-frame',(_,reply)=>page(reply,'<form method="GET" action="/sandbox/compat-result"><label>Reference <input id="reference" name="ref"></label><label>Plan <select id="plan" name="plan"><option value="basic">Basic</option><option value="pro">Pro</option></select></label><label><input id="confirmed" type="checkbox" name="confirmed" value="true">Confirmed</label><button>Lookup reference</button></form>'));
  app.get('/sandbox/compat-result',(req,reply)=>page(reply,`<p id="ref-result">${escape(req.query.ref)}</p><p id="plan-result">${escape(req.query.plan)}</p><p id="check-result">${req.query.confirmed==='true'?'true':'false'}</p>`));
  app.get('/sandbox/compat-popup',(_,reply)=>page(reply,'<h1>Login popup ready</h1><input aria-label="Popup field">'));
  app.get('/sandbox/compat-blocked',(_,reply)=>page(reply,'<p>Network diagnostic fixture</p><script src="https://assets.example.com/widget.js?secret=DO_NOT_DISCLOSE"></script>'));
  app.get('/sandbox/compat-challenge',(_,reply)=>page(reply,'<p data-testid="challenge">Verify you are human</p>'));
  app.get('/sandbox/compat-auth-rejected',(_,reply)=>page(reply,'<h1>Couldn’t sign you in</h1><p>This browser or app may not be secure.</p><button>Try again</button>'));
  app.get('/sandbox/compat-error',(_,reply)=>page(reply,'<h1>This site cannot be reached</h1><p>ERR_TUNNEL_CONNECTION_FAILED</p>'));
  app.get('/sandbox/compat-redirect',(_,reply)=>reply.redirect('https://accounts.google.com/?private=DO_NOT_DISCLOSE'));
  app.get('/sandbox/compat-denied',(_,reply)=>page(reply.code(403),'<h1>Access denied</h1>'));
  app.get('/sandbox/compat-login',(_,reply)=>page(reply,'<h1>Sign in</h1><label>Email <input type="email"></label><label>Password <input type="password"></label><button id="login-fetch">Sign in</button><a target="_blank" href="https://accounts.google.com/?private=DO_NOT_DISCLOSE">Google sign-in popup</a><p id="fetch-result"></p><script src="/sandbox/compat-login-fetch.js"></script>'));
  app.get('/sandbox/compat-login-fetch.js',(_,reply)=>reply.type('application/javascript').send("document.querySelector('#login-fetch').onclick=()=>fetch('/sandbox/compat-auth-redirect').catch(()=>document.querySelector('#fetch-result').textContent='Failed to fetch');"));
  app.get('/sandbox/compat-auth-redirect',(_,reply)=>reply.redirect('https://auth.openai.com/?private=DO_NOT_DISCLOSE'));
  app.get('/sandbox/compat-error-frame',(_,reply)=>page(reply,'<p id="frame-account">Frame error test account</p><iframe id="failed-frame" src="/sandbox/compat-error"></iframe>'));
}
