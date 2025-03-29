import { selectFolder, getDirectoryHandle, saveDatabaseToFolder, loadDatabaseFromFolder, scanFolderForScreenshots, getScreenshotFile, verifyPermission } from './fileAccess.js';
import { performOCR } from './ocr.js';

let db;
let exportIntervalId;
let currentFolderId = null;

// Global reference for active databases to prevent closing in use DBs
const activeDatabases = new Map();

async function initDB() {
    // Get current folder ID from localStorage (set in fileAccess.js)
    const folderId = localStorage.getItem('currentFolderId') || 'default';
    
    // Use different database name for each folder
    const dbName = `ScreenshotHistory_${folderId}`;
    console.log(`Initializing database for folder: ${folderId}`);
    
    // Check if we already have this DB instance cached
    const existingDb = activeDatabases.get(dbName);
    if (existingDb && !existingDb.isOpen()) {
        console.log(`Database ${dbName} was closed, reopening`);
        await existingDb.open();
    }
    
    // If we have an active DB with this name, use it
    if (existingDb && existingDb.isOpen()) {
        db = existingDb;
        return db;
    }
    
    // Close existing database if it's a different one
    if (db && db.name !== dbName && db.isOpen()) {
        console.log(`Closing previous database: ${db.name}`);
        try {
            db.close();
            // Remove from active DBs map
            activeDatabases.delete(db.name);
        } catch (e) {
            console.warn(`Error closing database ${db.name}:`, e);
        }
        db = null;
    }
    
    // Only create a new instance if needed
    if (!db || db.name !== dbName) {
        db = new Dexie(dbName);
        db.version(1).stores({
            screenshots: 'timestamp, ocrText, ocrProcessed', // Add ocrProcessed flag
            summaries: 'id, startTime, endTime, text',
            settings: 'key'
        });
        
        await db.open();
        // Add to active databases map
        activeDatabases.set(dbName, db);
        currentFolderId = folderId;
        
        // Check if we have a pending database import from the folder
        if (window._pendingDbImport) {
            await importFromJson(window._pendingDbImport);
            delete window._pendingDbImport;
        }
    }
    
    // Schedule database export
    scheduleDailyExport();
    return db;
}

// Clear entire database when switching folders
async function resetDatabase() {
    if (!db) return;
    
    try {
        console.log('Resetting database...');
        await db.screenshots.clear();
        await db.summaries.clear();
        console.log('Database reset complete');
    } catch (error) {
        console.error('Error resetting database:', error);
    }
}

// Import database from JSON
async function importFromJson(jsonData) {
    if (!db) await initDB();
    
    try {
        console.log('Importing database from JSON...');
        
        // Clear existing data first
        await resetDatabase();
        
        // Import screenshots
        if (jsonData.screenshots && Array.isArray(jsonData.screenshots)) {
            for (const screenshot of jsonData.screenshots) {
                // Don't import the URL as it won't be valid in this session
                const { url, ...data } = screenshot;
                await db.screenshots.put(data);
            }
            console.log(`Imported ${jsonData.screenshots.length} screenshots`);
        }
        
        // Import summaries
        if (jsonData.summaries && Array.isArray(jsonData.summaries)) {
            for (const summary of jsonData.summaries) {
                await db.summaries.put(summary);
            }
            console.log(`Imported ${jsonData.summaries.length} summaries`);
        }
        
        console.log('Database import complete');
    } catch (error) {
        console.error('Error importing database:', error);
        if (window.showNotification) {
            window.showNotification('Failed to import database', 'error');
        }
    }
}

// Export database to JSON
async function exportToJson() {
    if (!db) return null;
    
    try {
        // Export screenshots and summaries
        const screenshots = await db.screenshots.toArray();
        const summaries = await db.summaries.toArray();
        
        return {
            screenshots: screenshots.map(s => ({
                ...s,
                url: null  // Don't include blob URLs in export
            })),
            summaries,
            exportDate: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error exporting database to JSON:', error);
        return null;
    }
}

// Save current database to folder with rolling update mechanism
async function saveCurrentDatabaseToFolder() {
    const jsonData = await exportToJson();
    if (jsonData) {
        // Check if we have permission before attempting to save
        const dirHandle = await getDirectoryHandle();
        if (dirHandle) {
            try {
                const hasPermission = await verifyPermission(dirHandle, true);
                if (hasPermission) {
                    // Use rolling update to prevent database corruption
                    const mainDbFilename = 'screenshot-history-db.json';
                    const tempDbFilename = 'screenshot-history-db.temp.json';
                    const backupDbFilename = 'screenshot-history-db.backup.json';
                    
                    // 1. Write to temporary file first
                    const tempBlob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
                    const tempFileHandle = await dirHandle.getFileHandle(tempDbFilename, { create: true });
                    const tempWritable = await tempFileHandle.createWritable();
                    await tempWritable.write(tempBlob);
                    await tempWritable.close();
                    
                    // 2. Try to rename existing file to backup (if it exists)
                    try {
                        // Check if main db file exists
                        const mainFileHandle = await dirHandle.getFileHandle(mainDbFilename);
                        // If it exists, try to rename it to backup
                        try {
                            // Remove previous backup if it exists
                            try {
                                await dirHandle.removeEntry(backupDbFilename);
                            } catch (e) {
                                // Ignore error if backup doesn't exist
                            }
                            
                            // Create a new backup from the current main file
                            const mainFile = await mainFileHandle.getFile();
                            const backupFileHandle = await dirHandle.getFileHandle(backupDbFilename, { create: true });
                            const backupWritable = await backupFileHandle.createWritable();
                            await backupWritable.write(await mainFile.arrayBuffer());
                            await backupWritable.close();
                            
                            // Remove the old main file
                            await dirHandle.removeEntry(mainDbFilename);
                        } catch (e) {
                            console.warn('Error creating backup file:', e);
                        }
                    } catch (e) {
                        // Main db file doesn't exist yet, that's ok
                    }
                    
                    // 3. Rename temp file to main db file
                    try {
                        // Since File System Access API doesn't have direct rename, we need to:
                        // - Copy the temp file content to the main filename
                        // - Delete the temp file
                        const tempFile = await tempFileHandle.getFile();
                        const mainFileHandle = await dirHandle.getFileHandle(mainDbFilename, { create: true });
                        const mainWritable = await mainFileHandle.createWritable();
                        await mainWritable.write(await tempFile.arrayBuffer());
                        await mainWritable.close();
                        
                        // Delete the temp file
                        await dirHandle.removeEntry(tempDbFilename);
                        
                        return true;
                    } catch (e) {
                        console.error('Error renaming temp database file:', e);
                        if (window.showNotification) {
                            window.showNotification('Failed to save database. Please try again.', 'error');
                        }
                        return false;
                    }
                } else {
                    console.warn('No permission to save database, will try later');
                    window._needsDatabaseSave = jsonData;
                    return false;
                }
            } catch (e) {
                console.error('Error checking permissions:', e);
                return false;
            }
        }
    }
    return false;
}

// Modified version of addScreenshot with ocrProcessed flag
async function addScreenshot(timestamp, url, ocrText) {
    try {
        // Make sure DB is initialized
        if (!db || !db.isOpen()) {
            console.log('Database not open, initializing before adding screenshot');
            await initDB();
        }
        
        await db.screenshots.put({
            timestamp,            // This serves as the ID in the database
            url,                  // URL is temporary and not included in exports
            ocrText,              // The OCR text is what we want to persist
            ocrProcessed: true    // Mark as processed when adding with OCR text
        });
        
        // Reduced logging - only log if there's actual OCR text
        if (ocrText && ocrText.trim().length > 0) {
            console.log('Screenshot with OCR data added to DB');
        }
        
        // Mark for saving on next user interaction instead of immediate autosave
        window._needsDatabaseSave = true;
        
        // Update the UI if the updateUIWithNewScreenshot function is available
        try {
            if (window.updateUIWithNewScreenshot && url) {
                const screenshotInfo = {
                    timestamp,
                    url,
                    ocrText
                };
                
                // Flag for automatic UI refresh system
                window._newScreenshotCaptured = true;
                
                // Let the global update function handle the UI refresh
                window.updateUIWithNewScreenshot(screenshotInfo);
            }
        } catch (uiError) {
            console.warn('Error updating UI with new screenshot:', uiError);
            // The periodic refresh will handle it 
        }
    } catch (error) {
        console.error('Error adding screenshot to DB:', error);
        
        // Attempt to reopen the database if it's a DatabaseClosedError
        if (error.name === 'DatabaseClosedError') {
            console.log('Database was closed, attempting to reopen');
            await initDB();
        }
    }
}

// Add a function to check if screenshot was already OCR processed
async function isScreenshotOcrProcessed(timestamp) {
    try {
        if (!db || !db.isOpen()) {
            await initDB();
        }
        
        const screenshot = await db.screenshots.get(timestamp);
        return screenshot && screenshot.ocrProcessed === true;
    } catch (error) {
        console.warn('Error checking OCR status:', error);
        return false;
    }
}

// Mark a screenshot as OCR processed (for cases where we processed but got no text)
async function markScreenshotAsOcrProcessed(timestamp) {
    try {
        if (!db || !db.isOpen()) {
            await initDB();
        }
        
        const screenshot = await db.screenshots.get(timestamp);
        if (screenshot) {
            screenshot.ocrProcessed = true;
            await db.screenshots.put(screenshot);
        }
    } catch (error) {
        console.warn('Error marking screenshot as processed:', error);
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
        
        // Autosave database to folder after adding new data
        setTimeout(saveCurrentDatabaseToFolder, 5000);
        return id;
    } catch (error) {
        console.error('Error adding summary to DB:', error);
        return null;
    }
}

// Simplified function that directly accesses folder screenshots
// This is more efficient when we don't need OCR data filtering
async function getScreenshotsFromFolder(limit = null) {
    try {
        // Scan the folder for all screenshots
        const folderScreenshots = await scanFolderForScreenshots();
        
        // If a limit is provided, only return that many
        const limitedScreenshots = limit ? folderScreenshots.slice(0, limit) : folderScreenshots;
        
        // Create basic objects with timestamps that match DB entries
        return limitedScreenshots.map(screenshot => ({
            ...screenshot,
            url: null // URL will be set when needed for display
        }));
    } catch (error) {
        console.error('Error getting screenshots from folder:', error);
        return [];
    }
}

// Modified database search to handle database closed scenarios
async function searchScreenshots(searchTerm) {
    try {
        // Ensure database is open
        if (!db || !db.isOpen()) {
            console.log('Database not open, initializing before search');
            await initDB();
        }
        
        // First, get all the screenshots from the folder to have the full list
        const folderScreenshots = await scanFolderForScreenshots();
        
        // Create a map for quick lookup of screenshots by timestamp
        const screenshotMap = new Map();
        folderScreenshots.forEach(screenshot => {
            screenshotMap.set(screenshot.timestamp, screenshot);
        });
        
        // If no search term, return all screenshots from folder + all summaries
        if (!searchTerm) {
            // Get all summaries from database
            const summaries = await db.summaries.toArray();
            
            // For each screenshot, try to add OCR text from database if available
            const results = await Promise.all(folderScreenshots.map(async (screenshot) => {
                const dbEntry = await db.screenshots.get(screenshot.timestamp);
                
                // Create a merged object with file info and OCR text if available
                const result = {
                    ...screenshot,
                    ocrText: dbEntry ? dbEntry.ocrText : '',
                    ocrProcessed: dbEntry ? dbEntry.ocrProcessed : false,
                    url: null // Will be set when needed for display
                };
                
                // Get the actual file and create a URL if needed for immediate display
                const fileData = await getScreenshotFile(screenshot.fileHandle);
                if (fileData) {
                    result.url = fileData.url;
                    
                    // Check if we need to perform OCR (only if there's no OCR text AND it wasn't processed before)
                    if ((!dbEntry || dbEntry.ocrProcessed !== true)) {
                        // Only track in-progress OCR to prevent duplicate processing during this session
                        if (!window._ocr_in_progress) window._ocr_in_progress = new Set();
                        
                        // Skip if already in progress
                        if (!window._ocr_in_progress.has(screenshot.timestamp)) {
                            // Mark as in progress for this session
                            window._ocr_in_progress.add(screenshot.timestamp);
                            
                            // Schedule OCR in the background
                            setTimeout(async () => {
                                try {
                                    await performOCR(fileData.file, screenshot.timestamp, fileData.url);
                                } catch (e) {
                                    console.error('Error performing background OCR:', e);
                                    // Still mark as processed to avoid repeated failures
                                    await markScreenshotAsOcrProcessed(screenshot.timestamp);
                                } finally {
                                    // Remove from in-progress set
                                    if (window._ocr_in_progress) {
                                        window._ocr_in_progress.delete(screenshot.timestamp);
                                    }
                                }
                            }, 0);
                        }
                    }
                }
                
                return result;
            }));
            
            // Combine and sort screenshots and summaries
            return [...results, ...summaries].sort((a, b) => {
                const timeA = a.timestamp || a.endTime;
                const timeB = a.timestamp || a.endTime;
                return timeB.localeCompare(timeA); // Newest first
            });
        } else {
            // With a search term, first search the database for OCR text matches
            const matchingScreenshots = await db.screenshots
                .filter(item => item.ocrText && item.ocrText.toLowerCase().includes(searchTerm.toLowerCase()))
                .toArray();
            
            // Search summaries for matches
            const matchingSummaries = await db.summaries
                .filter(item => item.text && item.text.toLowerCase().includes(searchTerm.toLowerCase()))
                .toArray();
            
            // For each matching screenshot entry, get the corresponding file from the folder
            const results = await Promise.all(matchingScreenshots.map(async (dbEntry) => {
                // Try to find matching file in our folder scan results
                const folderEntry = screenshotMap.get(dbEntry.timestamp);
                
                if (folderEntry) {
                    // Get the file data for display
                    const fileData = await getScreenshotFile(folderEntry.fileHandle);
                    
                    return {
                        ...folderEntry,
                        ocrText: dbEntry.ocrText,
                        ocrProcessed: dbEntry.ocrProcessed,
                        url: fileData ? fileData.url : null
                    };
                } else {
                    // Database entry exists but file not found in folder
                    return {
                        timestamp: dbEntry.timestamp,
                        ocrText: dbEntry.ocrText,
                        ocrProcessed: dbEntry.ocrProcessed,
                        url: null,
                        missing: true // Flag to indicate file is missing
                    };
                }
            }));
            
            // Combine and sort screenshots and summaries
            return [...results, ...matchingSummaries].sort((a, b) => {
                const timeA = a.timestamp || a.endTime;
                const timeB = a.timestamp || a.endTime;
                return timeB.localeCompare(timeA); // Newest first
            });
        }
    } catch (error) {
        console.error('Error searching data:', error);
        // Attempt to reopen the database if it's a DatabaseClosedError
        if (error.name === 'DatabaseClosedError') {
            console.log('Database was closed, attempting to reopen');
            await initDB();
            // Try the search again after reopening
            return searchScreenshots(searchTerm);
        }
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

// Handle database saving during user interactions
function saveDbOnUserInteraction() {
    if (window._needsDatabaseSave) {
        saveCurrentDatabaseToFolder();
        window._needsDatabaseSave = false;
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
            const hasPermission = await verifyPermission(dirHandle, true);
            if (hasPermission) {
                // Save main database file to the folder
                await saveCurrentDatabaseToFolder();
            } else {
                console.log('No permission for auto-export, will try on next user interaction');
                window._needsDatabaseSave = true;
            }
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
    resetDatabase,
    saveCurrentDatabaseToFolder,
    importFromJson,
    getScreenshotsFromFolder,
    saveDbOnUserInteraction,
    isScreenshotOcrProcessed,
    markScreenshotAsOcrProcessed
};
