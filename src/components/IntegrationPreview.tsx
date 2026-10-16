import { ArrowRight, Check, Code2, Globe2 } from 'lucide-react';

export function IntegrationPreview() {
  return <div className="integration-preview" aria-label="A website workflow becomes a documented API">
    <div className="integration-preview-top"><span className="preview-dot"/>Workflow to API<span className="preview-label">HOW IT WORKS</span></div>
    <div className="integration-flow"><div className="integration-source"><Globe2 size={20}/><span>Your website</span></div><div className="integration-path"><i/><ArrowRight size={17}/><i/></div><div className="integration-destination"><Code2 size={20}/><span>Your API</span></div></div>
    <div className="integration-code"><span className="code-comment">// An example action</span><div><span className="code-method">POST</span> /v1/actions/order-lookup/versions/1/runs</div><pre>{'{ "input": { "order_id": "ORD-2041" } }'}</pre></div>
    <div className="integration-preview-bottom"><Check size={14}/>Define inputs. Verify outputs. Publish.</div>
  </div>;
}
