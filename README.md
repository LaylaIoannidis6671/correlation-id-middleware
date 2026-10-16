# correlation-id-middleware

Reads an incoming correlation id header (or generates a new v4 UUID) and attaches it to a per-request context plus a response header.

## Usage

```js
import { createContext } from 'correlation-id-middleware';

// `headers` is a plain object of header name -> value, as produced by
// Node's http.IncomingMessage.headers or any fetch-style Request.
const ctx = createContext({ 'x-correlation-id': '550e8400-e29b-41d4-a716-446655440000' });

// Use ctx.id anywhere you need to tag logs, spans, or downstream calls.
console.log({ correlationId: ctx.id }, 'request received');

// Echo it back to the caller.
const { name, value } = ctx.asHeader();
// response.setHeader(name, value);
```

The header name defaults to `x-correlation-id`. Pass `{ headerName: 'x-request-id' }` to read from and write to a different header. A custom UUID generator can be injected via `{ generator: () => string }` — useful in tests.

## Why this exists

Distributed traces need a stable identifier threaded through every hop. Reading the id from a request header is trivial; the interesting decisions are what to do when the header is missing or malformed, and how to carry the value through handler code without a hidden global.

This library makes two explicit choices:

1. **Incoming ids must be valid UUIDs.** A header value that isn't a well-formed RFC 4122 UUID (any version) is discarded and a fresh v4 is generated. The trade-off: a caller using a non-UUID id scheme will lose their trace and start a new one. The benefit: downstream services and log pipelines never receive an attacker-controlled free-form string masquerading as an identifier.

2. **No AsyncLocalStorage.** The context is a plain object the caller threads through explicitly. This keeps the library portable, testable, and free of runtime-specific globals. The cost is that you must pass `ctx` to the functions that need it rather than reading it from thin air.

## Edge cases worth knowing

- Header lookup is case-insensitive, as HTTP headers are. If the same header appears more than once (e.g. a proxy appended a second value), the first valid occurrence in insertion order wins.
- The generated id is a lowercase v4 UUID. Incoming UUIDs are normalised to lowercase so string comparisons are consistent.
- `createContext(null)` and `createContext({})` both produce a fresh id — there is no difference between "no headers" and "headers without the correlation id".

## Exports

| Name                      | Signature                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| `generateUuid`            | `() => string`                                                        |
| `normalizeCorrelationId` | `(value: unknown) => string \| null`                                   |
| `resolveCorrelationId`   | `(headers, options?) => string`                                       |
| `CorrelationContext`     | `class { constructor(id); readonly id; asHeader(name?) => {name, value} }` |
| `createContext`          | `(headers, options?) => CorrelationContext`                           |

`options` is `{ headerName?: string, generator?: () => string }`.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

