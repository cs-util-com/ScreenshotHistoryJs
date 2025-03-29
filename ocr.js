import { addScreenshot } from './storage.js';

// Cache for language loading status to avoid repeated errors
const languageLoadAttempts = {};
// Create a shared placeholder image URL
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';

// Default English language code - ALWAYS use 'eng', not 'en'
const DEFAULT_LANGUAGE = 'eng';

// Minimal worker logger to reduce console spam
const minimalLogger = {
    logger: m => {
        if (m.status === 'recognizing text' && m.progress === 1) {
            console.log('OCR completed');
        }
    },
    errorHandler: err => console.error('Tesseract Worker Error:', err)
};

async function performOCR(imageSource, timestamp, imageUrl) {
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
        
        // Create a Tesseract worker with minimal logging
        // Add a timeout to prevent the worker from hanging
        const worker = await Tesseract.createWorker(minimalLogger);
        
        let OCRcompleted = false;
        
        try {
            // Validate blob before passing to Tesseract
            if (imageBlob.size === 0) {
                throw new Error('Empty image blob');
            }
            
            try {
                await worker.loadLanguage(ocrLanguage);
                await worker.initialize(ocrLanguage);
                
                // Mark language as loaded successfully
                languageLoadAttempts[ocrLanguage] = 'loaded';
                
                // Perform recognition
                const { data } = await worker.recognize(imageBlob);
                OCRcompleted = true;
                await addScreenshot(timestamp, finalImageUrl, data.text);
            } catch (langError) {
                console.error(`Failed to load language '${ocrLanguage}':`, langError);
                languageLoadAttempts[ocrLanguage] = 'failed';
                
                // Only try English fallback if not already using it
                if (ocrLanguage !== DEFAULT_LANGUAGE) {
                    try {
                        await worker.loadLanguage(DEFAULT_LANGUAGE);
                        await worker.initialize(DEFAULT_LANGUAGE);
                        
                        const { data } = await worker.recognize(imageBlob);
                        OCRcompleted = true;
                        await addScreenshot(timestamp, finalImageUrl, data.text);
                    } catch (engError) {
                        console.error('Failed to perform OCR with English fallback:', engError);
                        languageLoadAttempts[DEFAULT_LANGUAGE] = 'failed';
                        await addScreenshot(timestamp, finalImageUrl, '');
                    }
                } else {
                    await addScreenshot(timestamp, finalImageUrl, '');
                }
            }
        } catch (error) {
            console.error('Tesseract processing error:', error);
            await addScreenshot(timestamp, finalImageUrl, '');
        } finally {
            // Always ensure we terminate the worker to free resources
            try {
                await worker.terminate();
            } catch (e) {
                console.warn('Error terminating Tesseract worker:', e);
            }
            
            // If OCR didn't complete, make sure we still save the screenshot
            if (!OCRcompleted) {
                await addScreenshot(timestamp, finalImageUrl, '');
            }
        }
    } catch (error) {
        console.error('OCR Error:', error);
        await addScreenshot(timestamp, imageUrl || null, '');
    }
}

export {
    performOCR,
    PLACEHOLDER_IMAGE
};
