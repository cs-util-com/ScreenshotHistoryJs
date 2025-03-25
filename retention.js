import {
    initDB
} from './storage.js';

let db;

async function performRetentionCheck() {
    try {
        // Initialize Dexie database if needed
        if (!db) {
            db = new Dexie('ScreenshotHistoryDB');
            db.version(1).stores({
                screenshots: 'timestamp, ocrText',
                summaries: 'id, startTime, endTime, text'
            });
            await db.open();
        }
        
        // Get retention period from settings (default 90 days)
        const retentionPeriod = parseInt(localStorage.getItem('retentionPeriod') || 90);
        console.log(`Performing retention check with ${retentionPeriod} days retention period`);
        
        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionPeriod);
        const cutoffTimestamp = cutoffDate.toISOString();
        
        // Find screenshots to delete
        const screenshotsToDelete = await db.screenshots
            .where('timestamp')
            .below(cutoffTimestamp)
            .toArray();
            
        // Find summaries to delete (based on endTime)
        const summariesToDelete = await db.summaries
            .filter(summary => summary.endTime < cutoffTimestamp)
            .toArray();
            
        console.log(`Found ${screenshotsToDelete.length} screenshots and ${summariesToDelete.length} summaries to delete`);
        
        // Delete old screenshots
        if (screenshotsToDelete.length > 0) {
            await Promise.all(screenshotsToDelete.map(async (screenshot) => {
                try {
                    // Revoke the object URL to prevent memory leaks
                    if (screenshot.url && screenshot.url.startsWith('blob:')) {
                        URL.revokeObjectURL(screenshot.url);
                    }
                    
                    // Delete from database
                    await db.screenshots.delete(screenshot.timestamp);
                } catch (error) {
                    console.error(`Error deleting screenshot ${screenshot.timestamp}:`, error);
                }
            }));
            
            console.log(`Deleted ${screenshotsToDelete.length} old screenshots`);
        }
        
        // Delete old summaries
        if (summariesToDelete.length > 0) {
            await Promise.all(summariesToDelete.map(async (summary) => {
                try {
                    await db.summaries.delete(summary.id);
                } catch (error) {
                    console.error(`Error deleting summary ${summary.id}:`, error);
                }
            }));
            
            console.log(`Deleted ${summariesToDelete.length} old summaries`);
        }
        
        console.log('Retention check complete');
    } catch (error) {
        console.error('Error performing retention check:', error);
    }
}

function scheduleRetentionCheck() {
    // Run the check on app load
    performRetentionCheck();
    
    // Then run daily
    const DAILY_INTERVAL = 24 * 60 * 60 * 1000;
    setInterval(performRetentionCheck, DAILY_INTERVAL);
}

export {
    scheduleRetentionCheck
};
