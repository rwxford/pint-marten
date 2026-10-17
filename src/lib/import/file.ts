import Papa from 'papaparse';
import type { ColumnMapping, MappingOptions } from './generic';
import { guessMapping, guessOptions } from './generic';
import type { ParsedImport } from './types';
import { looksLikeUntappd, parseUntappdRows } from './untappd';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ROWS = 200_000;

export type FileParseResult =
	| { kind: 'records'; parsed: ParsedImport }
	| {
			kind: 'table';
			headers: string[];
			rows: string[][];
			mapping: ColumnMapping;
			options: MappingOptions;
	  }
	| { kind: 'error'; message: string };

/**
 * Reads an import file's text. Untappd exports (CSV or JSON) become records directly; any other
 * table is returned with a guessed column mapping for the user to confirm.
 */
export function parseImportText(text: string, fileName: string): FileParseResult {
	const body = text.replace(/^\uFEFF/, '');
	if (!body.trim()) return { kind: 'error', message: 'The file is empty.' };

	if (/\.json$/i.test(fileName) || /^\s*[[{]/.test(body)) return parseJson(body);
	return parseDelimited(body);
}

function parseJson(body: string): FileParseResult {
	let data: unknown;
	try {
		data = JSON.parse(body);
	} catch {
		return { kind: 'error', message: 'This JSON file could not be read.' };
	}
	if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== 'object' || !data[0]) {
		return { kind: 'error', message: 'Expected a JSON list of check-ins.' };
	}
	if (data.length > MAX_ROWS) return tooManyRows();
	if (!looksLikeUntappd(Object.keys(data[0] as object))) {
		return {
			kind: 'error',
			message: 'Only Untappd JSON exports are supported. For other apps, export a CSV instead.'
		};
	}
	const rows = data.filter((d): d is Record<string, unknown> => !!d && typeof d === 'object');
	return { kind: 'records', parsed: parseUntappdRows(rows) };
}

function parseDelimited(body: string): FileParseResult {
	const result = Papa.parse<string[]>(body, { skipEmptyLines: 'greedy' });
	const table = result.data;
	if (table.length < 2)
		return { kind: 'error', message: 'Expected a header row and at least one data row.' };
	if (table.length - 1 > MAX_ROWS) return tooManyRows();

	const headers = table[0].map((h) => h.trim());
	const rows = table.slice(1);

	if (looksLikeUntappd(headers)) {
		const objects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
		return { kind: 'records', parsed: parseUntappdRows(objects) };
	}

	const mapping = guessMapping(headers);
	return { kind: 'table', headers, rows, mapping, options: guessOptions(rows, mapping) };
}

function tooManyRows(): FileParseResult {
	return {
		kind: 'error',
		message: `Files are limited to ${MAX_ROWS.toLocaleString('en-US')} rows.`
	};
}
