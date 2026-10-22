// Serialized into the selected document's isolated world. This function only
// observes DOM metadata; it never runs a workflow step or reads field values.
export function locatorProbeDocument(payload) {
  try {
    const fail = code => { throw Object.assign(new Error(code), { probeCode: code }); };
    const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
    const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
    const css = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 3000 && !/[\u0000-\u001f\u007f]/.test(value) && !/(?:>>|javascript\s*:|(?:^|\s)(?:xpath|text|id|data-testid|internal:[\w-]+)\s*=|:(?:has-text|text|text-is|text-matches|nth-match)\s*\(|=>|\b(?:eval|Function)\s*\()/i.test(value);
    const validLocator = value => plain(value) && (value.kind === 'role'
      ? keys(value, ['kind', 'role', 'name']) && typeof value.role === 'string' && /^[a-z]{1,40}$/.test(value.role) && text(value.name)
      : ['testId', 'label', 'css'].includes(value.kind) && keys(value, ['kind', 'value']) && (value.kind === 'css' ? css(value.value) : text(value.value)));
    if (!plain(payload) || !keys(payload, ['mode', 'selector', 'locators', 'operation', 'limit', 'origin', 'path_prefix', 'expires_at', 'require_ready']) || !['probe', 'candidates'].includes(payload.mode)
      || payload.selector !== undefined && !css(payload.selector)
      || payload.locators !== undefined && (!Array.isArray(payload.locators) || payload.locators.length < 1 || payload.locators.length > 6 || !payload.locators.every(validLocator))
      || !payload.selector && !payload.locators?.length
      || payload.operation !== undefined && !['click', 'fill', 'select', 'check', 'wait_element', 'wait_text'].includes(payload.operation)
      || payload.limit !== undefined && (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 8)
      || payload.origin !== undefined && (typeof payload.origin !== 'string' || payload.origin.length > 2048)
      || payload.path_prefix !== undefined && (typeof payload.path_prefix !== 'string' || !payload.path_prefix.startsWith('/') || payload.path_prefix.length > 2048 || /[\u0000-\u001f\u007f?#]/.test(payload.path_prefix))
      || payload.expires_at !== undefined && (typeof payload.expires_at !== 'number' || !Number.isFinite(payload.expires_at))
      || payload.require_ready !== undefined && typeof payload.require_ready !== 'boolean') fail('INVALID_PROBE');
    if (payload.origin !== undefined) {
      let expected; try { expected = new URL(payload.origin); } catch { fail('INVALID_PROBE'); }
      if (!['http:', 'https:'].includes(expected.protocol) || expected.origin !== payload.origin) fail('INVALID_PROBE');
    }
    const checkScope = () => { if (payload.origin !== undefined && location.origin !== payload.origin || payload.path_prefix !== undefined && !location.pathname.startsWith(payload.path_prefix) || payload.expires_at !== undefined && Date.now() >= payload.expires_at) fail('PROBE_UNAVAILABLE'); };
    checkScope();

    const uuid = () => {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    const registryKey = Symbol.for('hermo.locator.probe.v1');
    const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
    let registry = globalThis[registryKey];
    if (!registry || registry.document !== document || !validId(registry.id) || !(registry.nodes instanceof WeakMap)) {
      registry = { document, id: uuid(), nodes: new WeakMap() }; globalThis[registryKey] = registry;
    }
    const elementId = element => { let value = registry.nodes.get(element); if (!validId(value)) { value = uuid(); registry.nodes.set(element, value); } return value; };
    const excluded = element => {
      for (let current = element; current; current = current.parentElement ?? current.getRootNode()?.host) if (current.matches('[data-hermo-ui],script,style')) return true;
      return false;
    };
    const roots = [document], nodes = [];
    for (let index = 0; index < roots.length; index++) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (excluded(element)) continue;
        if (nodes.length >= 15000) fail('PROBE_LIMIT'); nodes.push(element);
        if (element.shadowRoot) { if (roots.length >= 80) fail('PROBE_LIMIT'); roots.push(element.shadowRoot); }
      }
    }
    const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim();
    const bounded = value => { const result = normalize(value); return text(result) ? result : ''; };
    const sensitive = element => element.matches('input[type=password],input[type=file],input[type=hidden],input[autocomplete=one-time-code],input[name=totpPin]');
    const visible = element => {
      if (excluded(element)) return false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') return false;
      for (let current = element; current; current = current.parentElement ?? current.getRootNode()?.host) {
        if (current.matches('[hidden],[aria-hidden="true"],.sr-only,.visually-hidden') || getComputedStyle(current).display === 'none') return false;
      }
      return true;
    };
    const enabled = element => !element.disabled && element.getAttribute('aria-disabled') !== 'true' && !element.closest('[inert]');
    // Inspection must not enumerate a login/challenge page or read form values
    // simply to detect that state. Trusted adapters request this extra gate.
    if (payload.require_ready && nodes.some(element => visible(element) && element.matches('input[type=password],input[autocomplete=one-time-code],input[name=totpPin],[data-sitekey],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"]'))) fail('PROBE_UNAVAILABLE');
    const labelText = node => {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 || node.matches('input,textarea,select,button,[contenteditable]')) return '';
      return [...node.childNodes].map(labelText).join('');
    };
    const associatedLabel = element => [...element.labels ?? []].map(labelText).join(' ');
    const explicitName = element => element.getAttribute('aria-label') || normalize((element.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => {
      const target = element.getRootNode().getElementById?.(id);
      return target && !target.matches('input,textarea,select,[contenteditable]') && !target.querySelector('input,textarea,select,[contenteditable]') ? target.textContent : '';
    }).join(' ')) || associatedLabel(element);
    const nameCache = new WeakMap();
    const name = element => {
      if (nameCache.has(element)) return nameCache.get(element);
      const remember = value => { nameCache.set(element, value); return value; };
      const explicit = explicitName(element); if (explicit) return remember(normalize(explicit));
      const alternative = element.getAttribute('alt'); if (alternative) return remember(normalize(alternative));
      // Unlike execution, an observation must never use a form value or an
      // editor's contents as its name. Such names cannot be repaired by role.
      if (element.matches('input,textarea,select') || element.isContentEditable || element.querySelector('input,textarea,select,[contenteditable]')) return remember('');
      return remember(normalize(element.textContent));
    };
    const role = element => {
      const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0]; if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'a' && element.hasAttribute('href')) return 'link'; if (tag === 'button') return 'button'; if (tag === 'textarea' || element.isContentEditable) return 'textbox';
      if (tag === 'input') return { checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox', button: 'button', submit: 'button', reset: 'button' }[element.type] ?? 'textbox';
      if (tag === 'select') return element.multiple || element.size > 1 ? 'listbox' : 'combobox'; if (/^h[1-6]$/.test(tag)) return 'heading';
      return { img: 'img', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', ul: 'list', ol: 'list', li: 'listitem', nav: 'navigation', main: 'main', option: 'option', progress: 'progressbar', dialog: 'dialog' }[tag];
    };
    const eligible = element => {
      if (excluded(element) || sensitive(element)) return false;
      if (payload.operation === 'click') return element.matches('button,a[href],[role=button],input[type=submit]');
      if (payload.operation === 'fill') return element.isContentEditable || element.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]):not([type=range]):not([type=color])');
      if (payload.operation === 'select') return element.matches('select');
      if (payload.operation === 'check') return element.matches('input[type=checkbox],input[type=radio]');
      return true;
    };
    function path(element) {
      const root = element.getRootNode(), parts = []; let current = element;
      while (current?.nodeType === 1) {
        let anchor;
        for (const attribute of ['data-testid', 'aria-label', 'name', 'id']) {
          const value = current.getAttribute(attribute);
          if (!value || value.length > 200 || attribute === 'id' && /^(radix-|:r|_r_)/.test(value)) continue;
          const candidate = attribute === 'id' ? '#' + CSS.escape(value) : `[${attribute}="${CSS.escape(value)}"]`;
          if (root.querySelectorAll(candidate).length === 1) { anchor = candidate; break; }
        }
        if (anchor) { parts.unshift(anchor); break; }
        const tag = current.tagName.toLowerCase(), siblings = [...current.parentNode?.children ?? []].filter(item => item.tagName === current.tagName);
        parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`); current = current.parentNode;
        if (parts.length > 120) fail('PROBE_LIMIT');
      }
      const own = parts.join(' > '); return root.host ? path(root.host) + ' ' + own : own;
    }
    const resolutionCache = new Map();
    const resolveLocator = locator => {
      const key = JSON.stringify(locator); if (resolutionCache.has(key)) return resolutionCache.get(key);
      const remember = value => { resolutionCache.set(key, value); return value; };
      if (locator.kind !== 'css') return remember(nodes.filter(element => locator.kind === 'testId' ? element.getAttribute('data-testid') === locator.value : locator.kind === 'role' ? role(element) === locator.role && name(element) === normalize(locator.name) : normalize(explicitName(element)) === normalize(locator.value)));
      const result = [];
      for (const root of roots) {
        let selector = locator.value;
        if (root.host) { const prefix = path(root.host) + ' '; if (!selector.startsWith(prefix)) continue; selector = selector.slice(prefix.length); }
        for (const element of root.querySelectorAll(selector)) if (!excluded(element)) { result.push(element); if (result.length > 15000) fail('PROBE_LIMIT'); }
      }
      return remember(result);
    };
    const rank = { testId: 0, role: 1, label: 2, css: 3 };
    const choices = [...payload.locators ?? []].sort((a, b) => rank[a.kind] - rank[b.kind]);
    if (payload.selector && !choices.some(item => item.kind === 'css' && item.value === payload.selector)) choices.push({ kind: 'css', value: payload.selector });
    const semantics = choices.filter(item => ['role', 'label'].includes(item.kind));
    const semanticMatch = element => !semantics.length || semantics.some(item => item.kind === 'role' ? role(element) === item.role && name(element) === normalize(item.name) : normalize(explicitName(element)) === normalize(item.value));
    let matches = [];
    for (const choice of choices) { matches = resolveLocator(choice); if (matches.length) break; }
    const target = matches.length === 1 && eligible(matches[0]) ? matches[0] : undefined;
    const metadata = element => {
      const actualRole = role(element), actualName = bounded(name(element));
      return { ...typeof actualRole === 'string' && /^[a-z]{1,40}$/.test(actualRole) ? { role: actualRole } : {}, ...actualName ? { name: actualName } : {} };
    };
    const result = { document_id: registry.id, matches: matches.length, visible: !!target && visible(target), enabled: !!target && enabled(target), semantic_match: !!target && semanticMatch(target), ...target ? { element_id: elementId(target), ...metadata(target) } : {} };
    if (payload.mode === 'candidates') {
      const candidates = [], eligibleCandidates = [], recordedCssNodes = new Set(choices.filter(item => item.kind === 'css').flatMap(resolveLocator));
      for (const element of nodes) {
        if (!eligible(element) || !visible(element) || !enabled(element)) continue;
        const control = element.matches('button,a[href],input,textarea,select,[role=button],[role=checkbox],[role=radio],[role=textbox]') || element.isContentEditable;
        if (!control) continue;
        const details = metadata(element), testId = element.getAttribute('data-testid'), label = bounded(explicitName(element));
        const reasons = [], recordedSemantic = semantics.length > 0 && semanticMatch(element), recordedId = choices.some(item => item.kind === 'testId' && element.getAttribute('data-testid') === item.value), recordedCss = recordedCssNodes.has(element);
        let score = 20;
        if (recordedSemantic) { score = 100; reasons.push('EXACT_SEMANTIC_MATCH'); }
        else if (recordedId) { score = 90; reasons.push('EXACT_TEST_ID_MATCH'); }
        else if (recordedCss) { score = 80; reasons.push('EXACT_CSS_MATCH'); }
        else if (choices.some(item => item.kind === 'role' && item.role === details.role)) { score = 40; reasons.push('SAME_CONTROL_ROLE'); }
        reasons.push('OPERATION_COMPATIBLE');
        eligibleCandidates.push({ element, details, testId, label, score, reasons });
      }
      // Rank cheap semantic evidence first; expensive uniqueness checks are
      // bounded independently of the number of controls on the website.
      eligibleCandidates.sort((a, b) => b.score - a.score);
      for (const { element, details, testId, label, score, reasons } of eligibleCandidates.slice(0, 64)) {
        const selector = path(element); if (!css(selector)) continue;
        const locators = [], proposed = [...text(testId) ? [{ kind: 'testId', value: testId }] : [], ...details.role && details.name ? [{ kind: 'role', role: details.role, name: details.name }] : [], ...label ? [{ kind: 'label', value: label }] : [], { kind: 'css', value: selector }];
        for (const locator of proposed) { const matched = resolveLocator(locator); if (matched.length === 1 && matched[0] === element) locators.push(locator); }
        if (!locators.length) continue;
        candidates.push({ element_id: elementId(element), selector, locators, ...details, score, reasons });
      }
      candidates.sort((a, b) => b.score - a.score || a.selector.localeCompare(b.selector));
      result.candidates = candidates.slice(0, payload.limit ?? 6);
    }
    checkScope(); return result;
  } catch (error) {
    return { hermo_error: ['INVALID_PROBE', 'PROBE_LIMIT', 'PROBE_UNAVAILABLE'].includes(error?.probeCode) ? error.probeCode : error?.name === 'SyntaxError' ? 'INVALID_PROBE' : 'PROBE_UNAVAILABLE' };
  }
}
