import {
    addScreenshot
} from './storage.js';

async function performOCR(imageBlob, timestamp) {
    try {
        // Get OCR language from local storage or use browser language
        const ocrLanguage = localStorage.getItem('ocrLanguage') || 
            navigator.language.split('-')[0] || 'eng';
            
        console.log(`Performing OCR in language: ${ocrLanguage}`);
            
        const {
            data: {
                text
            }
        } = await Tesseract.recognize(
            imageBlob,
            ocrLanguage,
            {
                logger: m => console.log(m)
            }
        );

        console.log('OCR Result:', text.slice(0, 100) + (text.length > 100 ? '...' : ''));
        await addScreenshot(timestamp, URL.createObjectURL(imageBlob), text);

    } catch (error) {
        console.error('OCR Error:', error);
        // Even if OCR fails, store the screenshot with empty text
        await addScreenshot(timestamp, URL.createObjectURL(imageBlob), '');
    }
}

export {
    performOCR
};
