import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateUuid,
  normalizeCorrelationId,
  resolveCorrelationId,
  CorrelationContext,
  createContext,
} from '../src/index.js';

// --- generateUuid ---------------------------------------------------------

test('generateUuid returns a lowercase v4 UUID string', () => {
  const id = generateUuid();
  assert.equal(typeof id, 'string');
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test('generateUuid produces distinct values across calls', () => {
  const a = generateUuid();
  const b = generateUuid();
  assert.notEqual(a, b);
});

// --- normalizeCorrelationId ----------------------------------------------

test('normalizeCorrelationId accepts a valid v4 UUID and lowercases it', () => {
  const input = 'A1B2C3D4-E5F6-4789-8ABC-DEF012345678';
  assert.equal(
    normalizeCorrelationId(input),
    'a1b2c3d4-e5f6-4789-8abc-def012345678',
  );
});

test('normalizeCorrelationId accepts a v1 UUID', () => {
  // A v1 UUID has version nibble 1. We accept any version.
  const input = '550e8400-e29b-11d4-a716-446655440000';
  assert.equal(normalizeCorrelationId(input), input);
});

test('normalizeCorrelationId rejects non-string input', () => {
  assert.equal(normalizeCorrelationId(null), null);
  assert.equal(normalizeCorrelationId(undefined), null);
  assert.equal(normalizeCorrelationId(123), null);
  assert.equal(normalizeCorrelationId({}), null);
});

test('normalizeCorrelationId rejects empty and whitespace-only strings', () => {
  assert.equal(normalizeCorrelationId(''), null);
  assert.equal(normalizeCorrelationId('   '), null);
});

test('normalizeCorrelationId rejects malformed strings', () => {
  assert.equal(normalizeCorrelationId('not-a-uuid'), null);
  assert.equal(normalizeCorrelationId('12345678123412341234123456789012'), null); // missing hyphens
  assert.equal(
    normalizeCorrelationId('gggggggg-gggg-gggg-gggg-gggggggggggg'),
    null,
  ); // non-hex chars
});

test('normalizeCorrelationId trims surrounding whitespace before validating', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(normalizeCorrelationId(`  ${id}  `), id);
});

// --- resolveCorrelationId -------------------------------------------------

test('resolveCorrelationId uses the incoming header when valid', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  const headers = { 'x-correlation-id': id };
  assert.equal(resolveCorrelationId(headers), id);
});

test('resolveCorrelationId matches header name case-insensitively', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  const headers = { 'X-Correlation-Id': id };
  assert.equal(resolveCorrelationId(headers), id);
});

test('resolveCorrelationId uses a custom header name', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  const headers = { 'x-request-id': id };
  assert.equal(resolveCorrelationId(headers, { headerName: 'x-request-id' }), id);
});

test('resolveCorrelationId generates a new id when the header is missing', () => {
  let calls = 0;
  const fakeGenerator = () => {
    calls += 1;
    return '00000000-0000-4000-8000-000000000000';
  };
  const result = resolveCorrelationId({}, { generator: fakeGenerator });
  assert.equal(result, '00000000-0000-4000-8000-000000000000');
  assert.equal(calls, 1);
});

test('resolveCorrelationId generates a new id when headers are null', () => {
  const fakeGenerator = () => '11111111-1111-4111-8111-111111111111';
  assert.equal(
    resolveCorrelationId(null, { generator: fakeGenerator }),
    '11111111-1111-4111-8111-111111111111',
  );
});

test('resolveCorrelationId generates a new id when the header value is invalid', () => {
  // An invalid incoming id must not be propagated — we replace it.
  let calls = 0;
  const fakeGenerator = () => {
    calls += 1;
    return '22222222-2222-4222-8222-222222222222';
  };
  const headers = { 'x-correlation-id': 'garbage' };
  assert.equal(
    resolveCorrelationId(headers, { generator: fakeGenerator }),
    '22222222-2222-4222-8222-222222222222',
  );
  assert.equal(calls, 1);
});

test('resolveCorrelationId uses the first matching header when duplicates exist', () => {
  // Object iteration order for string keys is insertion order, so the first
  // valid occurrence wins.
  const valid = '550e8400-e29b-41d4-a716-446655440000';
  const headers = {
    'x-correlation-id': valid,
    'X-Correlation-ID': '33333333-3333-4333-8333-333333333333',
  };
  assert.equal(resolveCorrelationId(headers), valid);
});

// --- CorrelationContext ---------------------------------------------------

test('CorrelationContext stores and exposes the id', () => {
  const ctx = new CorrelationContext('550e8400-e29b-41d4-a716-446655440000');
  assert.equal(ctx.id, '550e8400-e29b-41d4-a716-446655440000');
});

test('CorrelationContext.asHeader returns the default header pair', () => {
  const ctx = new CorrelationContext('550e8400-e29b-41d4-a716-446655440000');
  assert.deepEqual(ctx.asHeader(), {
    name: 'x-correlation-id',
    value: '550e8400-e29b-41d4-a716-446655440000',
  });
});

test('CorrelationContext.asHeader honours a custom header name', () => {
  const ctx = new CorrelationContext('550e8400-e29b-41d4-a716-446655440000');
  assert.deepEqual(ctx.asHeader('x-request-id'), {
    name: 'x-request-id',
    value: '550e8400-e29b-41d4-a716-446655440000',
  });
});

// --- createContext --------------------------------------------------------

test('createContext returns a context wrapping the resolved id', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  const ctx = createContext({ 'x-correlation-id': id });
  assert.ok(ctx instanceof CorrelationContext);
  assert.equal(ctx.id, id);
});

test('createContext generates an id when none is supplied and threads options through', () => {
  const ctx = createContext(null, {
    generator: () => '44444444-4444-4444-8444-444444444444',
  });
  assert.equal(ctx.id, '44444444-4444-4444-8444-444444444444');
});
