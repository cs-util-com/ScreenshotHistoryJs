import { selectFolder, getDirectoryHandle } from './fileAccess.js';

let db;
let exportIntervalId;

async function initDB() {
    db = new Dexie('ScreenshotHistoryDB');
    db.version(1).stores({
        screenshots: 'timestamp, ocrText',
        summaries: 'id, startTime, endTime, text',
        settings: 'key'
    });
    await db.open();
    
    // Schedule database export
    scheduleDailyExport();
    return db;
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

async function addSummary(startTime, endTime, text) {
    try {
        const id = `${startTime}_${endTime}`;
        await db.summaries.put({
            id,
            startTime,
            endTime,
            text,
            timestamp: new Date().toISOString() // for sorting in the UI
        });
        console.log('Summary added to DB:', id);
        return id;
    } catch (error) {
        console.error('Error adding summary to DB:', error);
        return null;
    }
}

async function searchScreenshots(searchTerm) {
    try {
        if (!searchTerm) {
            // Return all screenshots and summaries, sorted by timestamp
            const screenshots = await db.screenshots.toArray();
            const summaries = await db.summaries.toArray();
            
            // Combine and sort by timestamp
            const combined = [...screenshots, ...summaries].sort((a, b) => {
                const timeA = a.timestamp || a.endTime;
                const timeB = b.timestamp || b.endTime;
                return timeB.localeCompare(timeA); // Descending order (newest first)
            });
            
            return combined;
        } else {
            // Search screenshots by OCR text
            const screenshots = await db.screenshots
                .filter(item => item.ocrText && item.ocrText.toLowerCase().includes(searchTerm.toLowerCase()))
                .toArray();
                
            // Search summaries by text
            const summaries = await db.summaries
                .filter(item => item.text && item.text.toLowerCase().includes(searchTerm.toLowerCase()))
                .toArray();
                
            // Combine and sort
            return [...screenshots, ...summaries].sort((a, b) => {
                const timeA = a.timestamp || a.endTime;
                const timeB = b.timestamp || b.endTime;
                return timeB.localeCompare(timeA);
            });
        }
    } catch (error) {
        console.error('Error searching data:', error);
        return [];
    }
}

async function getSummary(startTime, endTime) {
    try {
        const id = `${startTime}_${endTime}`;
        return await db.summaries.get(id);
    } catch (error) {
        console.error('Error getting summary:', error);
        return null;
    }
}

async function getRecentScreenshots(hours = 0.5) {
    try {
        const now = new Date();
        const pastTime = new Date(now.getTime() - hours * 60 * 60 * 1000);
        
        return await db.screenshots
            .where('timestamp')
            .above(pastTime.toISOString())
            .toArray();
    } catch (error) {
        console.error('Error getting recent screenshots:', error);
        return [];
    }
}

// Database export functions
async function exportDBToJson(directoryHandle) {
    try {
        if (!directoryHandle) {
            console.warn('No directory handle available for DB export');
            return;
        }
        
        const date = new Date().toISOString().slice(0, 10);
        const filename = `db-${date}.json`;
        
        // Export both screenshots and summaries tables
        const screenshots = await db.screenshots.toArray();
        const summaries = await db.summaries.toArray();
        
        const exportData = {
            screenshots: screenshots.map(s => ({
                ...s,
                // Don't include the actual blob URLs in the export
                url: null,
                timestamp: s.timestamp,
                ocrText: s.ocrText
            })),
            summaries,
            exportDate: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });
        
        try {
            const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            
            console.log(`Database exported to ${filename}`);
        } catch (error) {
            console.error('Error writing DB export file:', error);
        }
    } catch (error) {
        console.error('Error exporting database:', error);
    }
}

function scheduleDailyExport() {
    // Export every 5 minutes as specified in the requirements
    const EXPORT_INTERVAL = 5 * 60 * 1000; // 5 minutes
    
    // Clear any existing export intervals
    if (exportIntervalId) {
        clearInterval(exportIntervalId);
    }
    
    exportIntervalId = setInterval(async () => {
        // Get the directory handle and export
        const dirHandle = await getDirectoryHandle();
        if (dirHandle) {
            await exportDBToJson(dirHandle);
        } else {
            console.log('No directory handle available for auto-export');
        }
    }, EXPORT_INTERVAL);
}

export {
    initDB,
    db,
    addScreenshot,
    addSummary,
    searchScreenshots,
    getSummary,
    getRecentScreenshots,
    exportDBToJson
};
