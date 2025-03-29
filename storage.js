import { selectFolder, getDirectoryHandle, saveDatabaseToFolder, loadDatabaseFromFolder, scanFolderForScreenshots, getScreenshotFile, verifyPermission } from './fileAccess.js';
import { performOCR } from './ocr.js';

let db;
let exportIntervalId;
let currentFolderId = null;

async function initDB() {
    // Get current folder ID from localStorage (set in fileAccess.js)
    const folderId = localStorage.getItem('currentFolderId') || 'default';
    
    // Use different database name for each folder
    const dbName = `ScreenshotHistory_${folderId}`;
    console.log(`Initializing database for folder: ${folderId}`);
    
    // Close existing database if open
    if (db && db.name !== dbName) {
        console.log(`Closing previous database: ${db.name}`);
        db.close();
        db = null;
    }
    
    // Only create a new instance if needed
    if (!db || db.name !== dbName) {
        db = new Dexie(dbName);
        db.version(1).stores({
            screenshots: 'timestamp, ocrText',
            summaries: 'id, startTime, endTime, text',
            settings: 'key'
        });
        
        await db.open();
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
                        
                        console.log('Database saved to folder successfully with rolling update');
                        return true;
                    } catch (e) {
                        console.error('Error renaming temp database file:', e);
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

async function addScreenshot(timestamp, url, ocrText) {
    try {
        await db.screenshots.put({
            timestamp,  // This serves as the ID in the database
            url,        // URL is temporary and not included in exports
            ocrText     // The OCR text is what we want to persist
        });
        
        // Reduced logging - only log if there's actual OCR text
        if (ocrText && ocrText.trim().length > 0) {
            console.log('Screenshot with OCR data added to DB');
        }
        
        // Mark for saving on next user interaction instead of immediate autosave
        window._needsDatabaseSave = true;
        
        // Update the UI if the updateUIWithNewScreenshot function is available
        // This is a fallback in case the direct update from capture.js doesn't work
        try {
            if (window.updateUIWithNewScreenshot && url) {
                const screenshotInfo = {
                    timestamp,
                    url,
                    ocrText
                };
                
                // Check if we already have this screenshot in the UI before updating
                const existingElement = document.querySelector(`p[data-timestamp="${timestamp}"]`);
                if (!existingElement) {
                    window.updateUIWithNewScreenshot(screenshotInfo);
                } else if (existingElement.textContent === 'Processing OCR...' && ocrText) {
                    // Update the OCR text if it's now available
                    existingElement.textContent = ocrText.length > 100 ? 
                        ocrText.substring(0, 100) + '...' : ocrText;
                }
            }
        } catch (uiError) {
            console.warn('Error updating UI with new screenshot:', uiError);
        }
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

// Modified search function for better error handling
async function searchScreenshots(searchTerm) {
    try {
        // First, get all the screenshots from the folder to have the full list
        // This ensures we have access to the images even if OCR isn't in the DB yet
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
                    url: null // Will be set when needed for display
                };
                
                // Get the actual file and create a URL if needed for immediate display
                const fileData = await getScreenshotFile(screenshot.fileHandle);
                if (fileData) {
                    result.url = fileData.url;
                    
                    // If we don't have OCR data for this screenshot, perform OCR in the background
                    if (!dbEntry || !dbEntry.ocrText) {
                        // Reduced logging - just perform the OCR without the verbose log
                        setTimeout(async () => {
                            try {
                                await performOCR(fileData.file, screenshot.timestamp, fileData.url);
                            } catch (e) {
                                console.error('Error performing background OCR:', e);
                            }
                        }, 0);
                    }
                }
                
                return result;
            }));
            
            // Combine and sort screenshots and summaries
            return [...results, ...summaries].sort((a, b) => {
                const timeA = a.timestamp || a.endTime;
                const timeB = b.timestamp || b.endTime;
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
                        url: fileData ? fileData.url : null
                    };
                } else {
                    // Database entry exists but file not found in folder
                    return {
                        timestamp: dbEntry.timestamp,
                        ocrText: dbEntry.ocrText,
                        url: null,
                        missing: true // Flag to indicate file is missing
                    };
                }
            }));
            
            // Combine and sort screenshots and summaries
            return [...results, ...matchingSummaries].sort((a, b) => {
                const timeA = a.timestamp || a.endTime;
                const timeB = b.timestamp || b.endTime;
                return timeB.localeCompare(timeA); // Newest first
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

// Database export functions - improved to use the rolling update mechanism
async function exportDBToJson(directoryHandle) {
    try {
        if (!directoryHandle) {
            console.warn('No directory handle available for DB export');
            return;
        }
        
        const date = new Date().toISOString().slice(0, 10);
        const filename = `db-${date}.json`;
        const tempFilename = `db-${date}.temp.json`;
        
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
            // Write to temp file first
            const tempFileHandle = await directoryHandle.getFileHandle(tempFilename, { create: true });
            const tempWritable = await tempFileHandle.createWritable();
            await tempWritable.write(blob);
            await tempWritable.close();
            
            // Check if main file exists already
            try {
                // If it does, remove it (we're creating a new daily backup anyway)
                await directoryHandle.removeEntry(filename);
            } catch (e) {
                // Ignore if file doesn't exist
            }
            
            // Copy temp to main file
            const tempFile = await tempFileHandle.getFile();
            const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(await tempFile.arrayBuffer());
            await writable.close();
            
            // Remove temp file
            await directoryHandle.removeEntry(tempFilename);
            
            console.log(`Database exported to ${filename}`);
        } catch (error) {
            console.error('Error writing DB export file:', error);
        }
    } catch (error) {
        console.error('Error exporting database:', error);
    }
}

// Handle database saving during user interactions
function saveDbOnUserInteraction() {
    if (window._needsDatabaseSave) {
        console.log('Attempting to save database on user interaction');
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
                
                // Also save the daily export as required in specs
                await exportDBToJson(dirHandle);
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
    exportDBToJson,
    resetDatabase,
    saveCurrentDatabaseToFolder,
    importFromJson,
    getScreenshotsFromFolder,
    saveDbOnUserInteraction
};
