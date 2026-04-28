import type { ManifestEntry } from '../models/index.js';

/**
 * CSV column names in snake_case, matching the manifest header row.
 */
export const MANIFEST_COLUMNS = ['file', 'modified', 'recipe_number', 'source'] as const;

/**
 * Map from camelCase ManifestEntry field names to snake_case CSV column names.
 */
const FIELD_TO_COLUMN: Record<string, string> = {
  file: 'file',
  modified: 'modified',
  recipeNumber: 'recipe_number',
  source: 'source',
};

/**
 * Map from snake_case CSV column names to camelCase ManifestEntry field names.
 */
const COLUMN_TO_FIELD: Record<string, string> = {
  file: 'file',
  modified: 'modified',
  recipe_number: 'recipeNumber',
  source: 'source',
};

/**
 * The ordered list of ManifestEntry field names matching MANIFEST_COLUMNS order.
 */
const FIELD_ORDER: (keyof ManifestEntry)[] = ['file', 'modified', 'recipeNumber', 'source'];

/**
 * Quote a field value per RFC 4180: wrap in double quotes if the value
 * contains a comma, double quote, or newline. Double quotes inside the
 * value are escaped by doubling them.
 */
function quoteField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialize an array of ManifestEntry objects into an RFC 4180-compliant CSV
 * string with LF line endings. The first row is the header row using
 * snake_case column names.
 */
export function serializeManifest(entries: ManifestEntry[]): string {
  const header = MANIFEST_COLUMNS.join(',');
  const rows = entries.map((entry) =>
    FIELD_ORDER.map((field) => quoteField(entry[field])).join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}

/**
 * Parse a single CSV row respecting RFC 4180 quoting rules.
 * Returns an array of field values.
 */
function parseRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  let field = '';
  let inQuotes = false;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Look ahead: doubled quote is an escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          // End of quoted section
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        fields.push(field);
        field = '';
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push the last field
  fields.push(field);
  return fields;
}

/**
 * Split a CSV string into logical rows, handling newlines inside quoted fields.
 * Returns an array of row strings (without the trailing newline).
 */
function splitRows(csv: string): string[] {
  const rows: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < csv.length) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < csv.length && csv[i + 1] === '"') {
          current += '""';
          i += 2;
        } else {
          inQuotes = false;
          current += ch;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        current += ch;
        i++;
      } else if (ch === '\n') {
        rows.push(current);
        current = '';
        i++;
      } else if (ch === '\r') {
        // Handle \r\n
        if (i + 1 < csv.length && csv[i + 1] === '\n') {
          rows.push(current);
          current = '';
          i += 2;
        } else {
          rows.push(current);
          current = '';
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    }
  }

  // Push remaining content if non-empty
  if (current.length > 0) {
    rows.push(current);
  }

  return rows;
}

/**
 * Parse an RFC 4180-compliant CSV string back into an array of ManifestEntry
 * objects. Expects the first row to be the header row with snake_case column
 * names. Maps snake_case columns back to camelCase ManifestEntry fields.
 */
export function parseManifest(csv: string): ManifestEntry[] {
  const rows = splitRows(csv);

  if (rows.length === 0) {
    return [];
  }

  // First row is the header
  const headerFields = parseRow(rows[0]);
  const columnIndices = headerFields.map((col) => col.trim());

  const entries: ManifestEntry[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Skip empty rows
    if (row.trim() === '') continue;

    const values = parseRow(row);
    const entry: Record<string, string> = {
      file: '',
      modified: '',
      recipeNumber: '',
      source: '',
    };

    for (let c = 0; c < columnIndices.length; c++) {
      const columnName = columnIndices[c];
      const fieldName = COLUMN_TO_FIELD[columnName];
      if (fieldName !== undefined && c < values.length) {
        entry[fieldName] = values[c];
      }
    }

    entries.push(entry as unknown as ManifestEntry);
  }

  return entries;
}
