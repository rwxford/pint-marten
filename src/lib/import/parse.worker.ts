import { MAX_FILE_BYTES, parseImportText, type FileParseResult } from './file';

// Parses import files off the main thread so large exports don't freeze the UI.
self.onmessage = async (event: MessageEvent<File>) => {
	const file = event.data;
	let result: FileParseResult;
	if (file.size > MAX_FILE_BYTES) {
		result = { kind: 'error', message: 'Files are limited to 50 MB.' };
	} else {
		try {
			result = parseImportText(await file.text(), file.name);
		} catch {
			result = { kind: 'error', message: 'This file could not be read.' };
		}
	}
	self.postMessage(result);
};
