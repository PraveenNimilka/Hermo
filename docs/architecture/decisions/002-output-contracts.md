# 002: Keep bounded declarative output contracts

Status: accepted.

## Context

REST and MCP consumers need the same result types and failure behavior. A DOM
read is not yet a verified workflow result. Mappings and schemas also cross
trust boundaries and must not become a way to execute code.

## Decision

Keep the existing Zod validation, bounded output mappings, shared normalization
and generated JSON Schema. Use the current contract helpers and Zod JSON Schema
conversion where appropriate; do not add Ajv or a second validation framework.
The supported declarative subset remains the source of truth rather than
accepting arbitrary user-provided JSON Schema.

Mappings support scalar values, nested objects and bounded arrays. They constrain
tree depth, field counts, collection sizes, selector syntax and extracted text
size. Normalization checks finite decimal numbers, explicit booleans and usable
HTTP(S) URLs without embedded credentials. Missing required values fail;
optional and nullable values follow their declared contract.

Generated contracts describe the normalized consumer result. Browser extraction,
normalization and verification use the accepted workflow snapshot, so a newer
publication does not reinterpret an older run. REST and MCP expose results only
after successful verification. MCP transport annotations describe behavior;
they do not grant execution authority.

Typed constraints and an explicit completion-marker rule extend this model.
The marker must change after the final action and remain stable while results
are extracted; it is a configured website observation, not a general proof of
backend completion. Generated media continues to require fresh assets. See the
[supported contract](../../reliability/output-verification.md).

## Consequences

The restricted format is less expressive than arbitrary schema or extraction
code, but it is reviewable and enforceable across both browser adapters. New
types or constraints must update author validation, extraction, normalization,
generated contracts and negative tests together. JSON Schema cannot represent
every Zod refinement or transform; conversion must preserve the supported input
and output semantics rather than silently broadening an unsupported constraint.

## Primary references

- [Zod JSON Schema conversion and unsupported types](https://zod.dev/json-schema)
- [Fastify validation and schema trust](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Ajv security model for untrusted schemas](https://ajv.js.org/security.html)
- [MCP tools and output schemas](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
