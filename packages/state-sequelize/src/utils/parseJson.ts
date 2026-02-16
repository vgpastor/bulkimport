/**
 * Safely parse a value that may be a JSON string or already a parsed object.
 *
 * MySQL/MariaDB with certain driver versions return JSON columns as strings
 * instead of parsed objects. This function handles both cases defensively.
 */
export function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value) as unknown;
  }
  return value;
}
