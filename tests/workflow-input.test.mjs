import test from 'node:test';
import assert from 'node:assert/strict';
import {chatPromptInputs,workflowInputSchema} from '../server/workflow-input.mjs';

test('chat inputs trim invisible outer whitespace before replay and preserve multiline content',()=>{
  const original={prompt:{type:'string',example:'\nhi'}};
  const inputs=chatPromptInputs(original),schema=workflowInputSchema(inputs);
  assert.equal(inputs.prompt.example,'hi');assert.equal(original.prompt.example,'\nhi');
  assert.deepEqual(schema.parse({prompt:'\nhi'}),{prompt:'hi'});
  assert.deepEqual(schema.parse({prompt:' \r\nFirst line\n\n  indented code\nLast line\t '}),{prompt:'First line\n\n  indented code\nLast line'});
  for(const prompt of ['',' \r\n\t ','x'.repeat(4097)])assert.equal(schema.safeParse({prompt}).success,false);
  assert.equal(schema.safeParse({prompt:'hi',unexpected:'extra'}).success,false);
});

test('unrelated freeform and patterned contracts retain exact input semantics',()=>{
  const schema=workflowInputSchema({reference:{type:'string'},order:{type:'string',pattern:'^[A-Za-z0-9_-]+$'}});
  assert.deepEqual(schema.parse({reference:'\nkeep this\n',order:'ORD-1'}),{reference:'\nkeep this\n',order:'ORD-1'});
  assert.equal(schema.safeParse({reference:'reference',order:' ORD-1 '}).success,false);
});
