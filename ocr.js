import { addScreenshot, isScreenshotOcrProcessed, markScreenshotAsOcrProcessed } from './storage.js';
import { saveThumbnail } from './fileAccess.js';

// Cache for language loading status to avoid repeated errors
const languageLoadAttempts = {};
// Create a shared placeholder image URL
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';

// Default English language code - ALWAYS use 'eng', not 'en'
const DEFAULT_LANGUAGE = 'eng';

// OCR processing configuration
const OCR_CONFIG = {
  maxImageWidth: 1280,     // Max width for OCR processing
  maxImageHeight: 800,     // Max height for OCR processing
  maxRetries: 2,           // Number of retries with reduced resolution
  rescaleFactor: 0.5       // How much to reduce on each retry
};

// Tracking for in-progress OCR to prevent duplicate processing in the current session only
const inProgressOcr = new Set();

// Minimal worker logger to reduce console spam
const minimalLogger = {
    logger: m => {
        if (m.status === 'recognizing text' && m.progress === 1) {
            console.log('OCR completed');
        }
    },
    errorHandler: err => console.error('Tesseract Worker Error:', err)
};

// Downscale image for OCR processing while maintaining aspect ratio
async function downscaleImageForOCR(imageBlob, maxWidth = OCR_CONFIG.maxImageWidth, maxHeight = OCR_CONFIG.maxImageHeight) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            // Create canvas for resizing
            const canvas = document.createElement('canvas');
            
            // Calculate new dimensions while maintaining aspect ratio
            let width = img.width;
            let height = img.height;
            
            // Only downscale if the image is larger than limits
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
                
                console.log(`Downscaling image for OCR from ${img.width}x${img.height} to ${width}x${height}`);
            } else {
                // If already small enough, just use the original
                URL.revokeObjectURL(img.src);
                resolve({ blob: imageBlob, canvas: null });
                return;
            }
            
            // Resize the image
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to Blob
            canvas.toBlob(blob => {
                URL.revokeObjectURL(img.src);
                // Return both the blob and the canvas for thumbnail creation
                resolve({ blob, canvas });
            }, 'image/jpeg', 0.85);
        };
        
        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error('Failed to load image for downscaling'));
        };
        
        img.src = URL.createObjectURL(imageBlob);
    });
}

async function performOCR(imageSource, timestamp, imageUrl, thumbnailFilename = null) {
    try {
        // Check database first if this image was already processed
        if (await isScreenshotOcrProcessed(timestamp)) {
            console.log(`OCR already completed for image ${timestamp} (found in database), skipping`);
            return;
        }
    } catch (dbError) {
        // If database check fails, continue with in-memory check as fallback
        console.warn('Error checking OCR status in database:', dbError);
    }
    
    // Skip if this image is already being processed in the current session
    if (inProgressOcr.has(timestamp)) {
        console.log(`OCR already in progress for image ${timestamp}, skipping duplicate job`);
        return;
    }
    
    // Mark this timestamp as being processed for this session
    inProgressOcr.add(timestamp);
    
    try {
        // Early validation check before processing
        if (!imageSource) {
            console.error('Invalid image source: null or undefined');
            await addScreenshot(timestamp, imageUrl, '');
            return;
        }
        
        // Handle different input types (File object or Blob)
        const imageBlob = (imageSource instanceof Blob) ? imageSource : null;
        if (!imageBlob) {
            console.error('Invalid image source type:', typeof imageSource);
            await addScreenshot(timestamp, imageUrl, '');
            return;
        }
        
        // Ensure we have a valid imageUrl
        const finalImageUrl = imageUrl || URL.createObjectURL(imageBlob);
        
        // Store the blob in the global storage to prevent garbage collection
        if (!window._savedBlobs) {
            window._savedBlobs = {};
        }
        window._savedBlobs[timestamp] = imageBlob.slice(0);
        
        // Get OCR language, with fallback to browser language or English
        // IMPORTANT: Always normalize to proper Tesseract language code (eng not en)
        let ocrLanguage = localStorage.getItem('ocrLanguage') || 
            (navigator.language && navigator.language.split('-')[0]) || DEFAULT_LANGUAGE;
            
        // Normalize language code - Tesseract uses 3-letter codes (eng, fra, deu, etc.)
        if (ocrLanguage === 'en') ocrLanguage = 'eng';
        if (ocrLanguage === 'fr') ocrLanguage = 'fra';
        if (ocrLanguage === 'de') ocrLanguage = 'deu';
        if (ocrLanguage === 'es') ocrLanguage = 'spa';
        if (ocrLanguage === 'it') ocrLanguage = 'ita';
        
        // Handle previously failed language loading
        if (languageLoadAttempts[ocrLanguage] === 'failed') {
            if (ocrLanguage !== DEFAULT_LANGUAGE) {
                // Fall back to English
                ocrLanguage = DEFAULT_LANGUAGE;
                console.log(`Using default language (${DEFAULT_LANGUAGE}) due to previous failure`);
            } else {
                // If English also fails, store the screenshot without OCR
                console.error('Cannot perform OCR: language data unavailable');
                await addScreenshot(timestamp, finalImageUrl, '');
                return;
            }
        }
        
        // Downscale the image for OCR to prevent memory issues
        let processingBlob;
        let thumbnailCanvas;
        try {
            const result = await downscaleImageForOCR(imageBlob);
            processingBlob = result.blob;
            thumbnailCanvas = result.canvas;
            
            // Save downscaled image as thumbnail if we have a canvas and filename
            if (thumbnailCanvas && thumbnailFilename) {
                thumbnailCanvas.toBlob(async (thumbnailBlob) => {
                    await saveThumbnail(thumbnailBlob, thumbnailFilename);
                }, 'image/jpeg', 0.7);
            }
        } catch (e) {
            console.error('Error downscaling image for OCR:', e);
            processingBlob = imageBlob; // Fallback to original if downscaling fails
        }
        
        let retryCount = 0;
        let success = false;
        let ocrText = '';
        
        // Try OCR with progressive downscaling if needed
        while (retryCount <= OCR_CONFIG.maxRetries && !success) {
            try {
                // Create a Tesseract worker with minimal logging
                const worker = await Tesseract.createWorker(minimalLogger);
                
                try {
                    // Validate blob before passing to Tesseract
                    if (processingBlob.size === 0) {
                        throw new Error('Empty image blob');
                    }
                    
                    await worker.loadLanguage(ocrLanguage);
                    await worker.initialize(ocrLanguage);
                    
                    // Mark language as loaded successfully
                    languageLoadAttempts[ocrLanguage] = 'loaded';
                    
                    // Perform recognition
                    const { data } = await worker.recognize(processingBlob);
                    ocrText = data.text;
                    success = true;
                } catch (langError) {
                    console.error(`Failed to load language '${ocrLanguage}':`, langError);
                    
                    // If this was a memory error, try with further downscaling
                    if (langError.message && langError.message.includes('memory') && retryCount < OCR_CONFIG.maxRetries) {
                        retryCount++;
                        const newWidth = OCR_CONFIG.maxImageWidth * Math.pow(OCR_CONFIG.rescaleFactor, retryCount);
                        const newHeight = OCR_CONFIG.maxImageHeight * Math.pow(OCR_CONFIG.rescaleFactor, retryCount);
                        
                        console.log(`Retry ${retryCount}: Reducing image to ${newWidth}x${newHeight} for OCR`);
                        processingBlob = await downscaleImageForOCR(imageBlob, newWidth, newHeight);
                    } else if (ocrLanguage !== DEFAULT_LANGUAGE) {
                        // Try fallback to English
                        try {
                            await worker.loadLanguage(DEFAULT_LANGUAGE);
                            await worker.initialize(DEFAULT_LANGUAGE);
                            
                            const { data } = await worker.recognize(processingBlob);
                            ocrText = data.text;
                            success = true;
                        } catch (engError) {
                            console.error('Failed to perform OCR with English fallback:', engError);
                            languageLoadAttempts[DEFAULT_LANGUAGE] = 'failed';
                        }
                    }
                } finally {
                    // Always terminate the worker
                    try {
                        await worker.terminate();
                    } catch (e) {
                        console.warn('Error terminating Tesseract worker:', e);
                    }
                }
            } catch (error) {
                console.error('Tesseract processing error:', error);
                retryCount++;
                
                // If not a memory error or last retry, break the loop
                if ((!error.message || !error.message.includes('memory')) && retryCount > OCR_CONFIG.maxRetries) {
                    break;
                }
                
                // Further reduce image size for next retry
                if (retryCount <= OCR_CONFIG.maxRetries) {
                    const newWidth = OCR_CONFIG.maxImageWidth * Math.pow(OCR_CONFIG.rescaleFactor, retryCount);
                    const newHeight = OCR_CONFIG.maxImageHeight * Math.pow(OCR_CONFIG.rescaleFactor, retryCount);
                    
                    if (window.showNotification) {
                        window.showNotification(`OCR memory issue - retrying with smaller image (${Math.round(newWidth)}x${Math.round(newHeight)})`, 'warning');
                    }
                    
                    try {
                        processingBlob = await downscaleImageForOCR(imageBlob, newWidth, newHeight);
                    } catch (e) {
                        console.error('Failed to downscale on retry:', e);
                        break;
                    }
                }
            }
        }
        
        // Store the screenshot with whatever OCR text we got (even if empty)
        // The addScreenshot function will mark it as processed in the database
        await addScreenshot(timestamp, finalImageUrl, ocrText);
        
    } catch (error) {
        console.error('OCR Error:', error);
        // Still add to DB but with empty text, and mark as processed
        await addScreenshot(timestamp, imageUrl || null, '');
        // Explicitly mark as processed in case addScreenshot didn't
        await markScreenshotAsOcrProcessed(timestamp);
    } finally {
        // Remove from in-progress set for this session
        inProgressOcr.delete(timestamp);
    }
}

export {
    performOCR,
    PLACEHOLDER_IMAGE
};
