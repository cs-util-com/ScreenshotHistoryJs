import {
    initDB
} from './storage.js';

async function performRetentionCheck() {
    const retentionPeriod = localStorage.getItem('retentionPeriod') || 90;
    const cutoffDate = new Date(Date.now() - retentionPeriod * 24 * 60 * 60 * 1000);
    const cutoffTimestamp = cutoffDate.toISOString();

    try {
        const db = new Dexie('ScreenshotHistoryDB');
        db.version(1).stores({
            screenshots: 'timestamp, ocrText'
        });
        await db.open();

        const screenshotsToDelete = await db.screenshots
            .where('timestamp')
            .below(cutoffTimestamp)
            .toArray();

        for (const screenshot of screenshotsToDelete) {
            await db.screenshots.delete(screenshot.timestamp);
            console.log('Deleted screenshot:', screenshot.timestamp);
        }

        console.log('Retention check complete.');

    } catch (error) {
        console.error('Error performing retention check:', error);
    }
}

function scheduleRetentionCheck() {
    // Run the check on app load and then every 24 hours
    performRetentionCheck();
    setInterval(performRetentionCheck, 24 * 60 * 60 * 1000);
}

export {
    scheduleRetentionCheck
};
