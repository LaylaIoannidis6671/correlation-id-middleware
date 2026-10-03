/**
 * Generate a v4 UUID using only the standard library.
 *
 * We use globalThis.crypto which is available in Node 16+ via the WebCrypto API
 * and in browsers. We deliberately avoid importing 'node:crypto' so the module
 * stays portable across runtimes without any conditional imports. The UUID
 * is formatted as 8-4-4-4-12 hex characters per RFC 4122.
 *
 * @returns {string} a lowercase v4 UUID string
 */
export function generateUuid() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // Per RFC 4122 §4.4: set version (high nibble of byte 6) to 4,
  // and variant (high bits of byte 8) to the 10xx pattern.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * Validate that a string is a plausible correlation identifier.
 *
 * The contract here is deliberately strict: a correlation id must look like a
 * RFC 4122 UUID (any version). The reason is that when we *propagate* an
 * incoming id downstream, we treat it as trusted input. Accepting arbitrary
 * free-form strings would let clients smuggle data into logs and downstream
 * headers in ways that are hard to filter later. If a client sends an id we
 * don't recognise, we generate a fresh one instead of echoing theirs.
 *
 * We accept any UUID version (not just v4) because a service upstream may
 * itself have generated the id using a different strategy (e.g. time-based
 * v1). The version field is not part of our concern.
 *
 * We also normalise to lowercase so downstream comparisons are consistent.
 *
 * @param {unknown} value
 * @returns {string | null} the normalised UUID, or null if invalid
 */
export function normalizeCorrelationId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // 8-4-4-4-12 hex digits. Case-insensitive.
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

/**
 * Resolve the correlation id for an incoming request.
 *
 * The header name is configurable. When the header is absent or contains a
 * value that fails validation, a fresh UUID is generated via the provided
 * generator function. This means a misbehaving caller cannot poison the
 * trace; they simply lose their seat on it.
 *
 * @param {Record<string, string> | null | undefined} headers
 * @param {object} options
 * @param {string} [options.headerName='x-correlation-id'] - case-insensitive
 * @param {() => string} [options.generator] - defaults to generateUuid
 * @returns {string} a valid, lowercase correlation id
 */
export function resolveCorrelationId(headers, options = {}) {
  const headerName = options.headerName ?? 'x-correlation-id';
  const generator = options.generator ?? generateUuid;

  if (headers != null && typeof headers === 'object') {
    const lowerTarget = headerName.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lowerTarget) {
        const candidate = normalizeCorrelationId(headers[key]);
        if (candidate !== null) {
          return candidate;
        }
        // Invalid format: fall through to generation rather than propagating
        // an untrusted value.
        break;
      }
    }
  }

  return generator();
}

/**
 * A minimal, opaque container that lets handlers read the active correlation
 * id without receiving it as an explicit argument.
 *
 * We deliberately avoid AsyncLocalStorage here. It would be the idiomatic way
 * to propagate a value through an async call chain, but it adds runtime
 * requirements and conceptual overhead that this small library does not need.
 * Instead the context is a plain object the caller threads through manually —
 * explicit, testable, and free of hidden globals.
 */
export class CorrelationContext {
  /** @type {string} */
  #id;

  /**
   * @param {string} id - a correlation id that has already been validated
   */
  constructor(id) {
    this.#id = id;
  }

  /**
   * @returns {string} the correlation id for the current request
   */
  get id() {
    return this.#id;
  }

  /**
   * Convenience method for setting the response header in frameworks that
   * accept a plain object (e.g. Node's native http, undici, or Express's
   * res.set). Returns the header name/value pair so the caller can also use
   * it inline.
   *
   * @param {string} [headerName] - override the default response header name
   * @returns {{name: string, value: string}}
   */
  asHeader(headerName = 'x-correlation-id') {
    return { name: headerName, value: this.#id };
  }
}

/**
 * Build a correlation context for a request.
 *
 * Thin wrapper around resolveCorrelationId + CorrelationContext so callers
 * have a single entry point.
 *
 * @param {Record<string, string> | null | undefined} headers
 * @param {object} [options]
 * @param {string} [options.headerName]
 * @param {() => string} [options.generator]
 * @returns {CorrelationContext}
 */
export function createContext(headers, options = {}) {
  return new CorrelationContext(resolveCorrelationId(headers, options));
}
