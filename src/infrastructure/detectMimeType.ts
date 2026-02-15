/** Detect MIME type from a file name or path based on its extension. */
export function detectMimeType(fileNameOrPath: string): string {
  const ext = fileNameOrPath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    case 'xml':
      return 'application/xml';
    case 'tsv':
      return 'text/tab-separated-values';
    default:
      return 'text/plain';
  }
}
