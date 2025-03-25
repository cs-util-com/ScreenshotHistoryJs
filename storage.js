let db;

async function initDB() {
    db = new Dexie('ScreenshotHistoryDB');
    db.version(1).stores({
        screenshots: 'timestamp, ocrText'
    });
    await db.open();
}

async function addScreenshot(timestamp, url, ocrText) {
    try {
        await db.screenshots.put({
            timestamp,
            url,
            ocrText
        });
        console.log('Screenshot added to DB:', timestamp);
    } catch (error) {
        console.error('Error adding screenshot to DB:', error);
    }
}

async function searchScreenshots(searchTerm) {
    try {
        const results = await db.screenshots
            .where('ocrText')
            .startsWith(searchTerm)
            .toArray();
        return results;
    } catch (error) {
        console.error('Error searching screenshots:', error);
        return [];
    }
}

export {
    initDB,
    addScreenshot,
    searchScreenshots
};
