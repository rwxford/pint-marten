import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => `tests/fixtures/${name}`;

async function chooseFile(page: Page, name: string) {
	await page.goto('/import');
	await page.locator('input[type="file"]').setInputFiles(fixture(name));
}

function stat(page: Page, label: string) {
	return page
		.locator('.stat-grid div')
		.filter({ has: page.getByText(label, { exact: true }) })
		.locator('dd');
}

test('imports an Untappd export and ignores re-imports', async ({ page }) => {
	const problems: string[] = [];
	page.on('console', (msg) => msg.type() === 'error' && problems.push(msg.text()));
	page.on('pageerror', (err) => problems.push(err.message));

	await chooseFile(page, 'untappd-sample.csv');
	await expect(page.getByRole('heading', { name: 'Untappd export' })).toBeVisible();
	await expect(stat(page, 'Check-ins')).toHaveText('8');
	await page.getByRole('button', { name: 'Import 8 check-ins' }).click();

	await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
	await expect(stat(page, 'Added')).toHaveText('8');
	await page.getByRole('link', { name: 'Done' }).click();

	await expect(page.getByRole('heading', { name: 'Your history' })).toBeVisible();
	await expect(stat(page, 'Check-ins')).toHaveText('8');
	await expect(stat(page, 'Venues')).toHaveText('3');
	await expect(
		page.getByText('4 beers · 1 cider · 1 mead · 1 other · 2 non-alcoholic')
	).toBeVisible();

	// The JSON export holds the same check-ins, so nothing new is added.
	await chooseFile(page, 'untappd-sample.json');
	await page.getByRole('button', { name: 'Import 8 check-ins' }).click();
	await expect(stat(page, 'Added')).toHaveText('0');
	await expect(stat(page, 'Already had')).toHaveText('8');

	expect(problems).toEqual([]);
});

test('maps spreadsheet columns and reviews a near-duplicate', async ({ page }) => {
	await chooseFile(page, 'untappd-sample.csv');
	await page.getByRole('button', { name: 'Import 8 check-ins' }).click();
	await expect(stat(page, 'Added')).toHaveText('8');

	await page.getByRole('button', { name: 'Import another file' }).click();
	await page.locator('input[type="file"]').setInputFiles(fixture('generic-sample.csv'));
	await expect(page.getByRole('heading', { name: 'Match columns' })).toBeVisible();
	await expect(page.getByLabel('Drink name *')).toHaveValue('0');
	await expect(page.getByLabel('Date format')).toHaveValue('dmy');
	await expect(page.locator('.preview li').first()).toContainText('Marten Haze');
	await expect(page.locator('.preview li').first()).toContainText('2024-05-16');

	// Unmapping a required column blocks the import.
	await page.getByLabel('Drink name *').selectOption('');
	await expect(page.getByText('Choose a column for: Drink name')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Import \d+ rows$/ })).toBeDisabled();
	await page.getByLabel('Drink name *').selectOption('0');

	await page.getByRole('button', { name: /^Import \d+ rows$/ }).click();
	await expect(stat(page, 'Added')).toHaveText('4');
	await expect(page.getByText('1 rows skipped or partly imported')).toBeVisible();

	await page.getByRole('link', { name: '1 possible duplicate to review' }).click();
	await expect(page.getByText(/Is Marten Hazey .* the same as Marten Haze/)).toBeVisible();
	await page.getByRole('button', { name: 'Same — merge' }).click();
	await expect(page.getByText('Nothing to review.')).toBeVisible();
});

test('deletes all data after confirmation', async ({ page }) => {
	await chooseFile(page, 'untappd-sample.json');
	await page.getByRole('button', { name: 'Import 8 check-ins' }).click();
	await page.getByRole('link', { name: 'Done' }).click();
	await expect(page.getByRole('heading', { name: 'Your history' })).toBeVisible();

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete all data' }).click();
	await expect(page.getByRole('heading', { name: 'Start with your history' })).toBeVisible();
});

test('explains files it cannot import', async ({ page }) => {
	await page.goto('/import');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'notes.json',
		mimeType: 'application/json',
		buffer: Buffer.from('[{"title":"not a check-in"}]')
	});
	await expect(page.getByRole('alert')).toContainText('Only Untappd JSON exports are supported');
});
