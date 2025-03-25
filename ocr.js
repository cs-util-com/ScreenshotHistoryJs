import {
    addScreenshot
} from './storage.js';

async function performOCR(imageBlob, timestamp) {
    try {
        const ocrLanguage = localStorage.getItem('ocrLanguage') || 'eng';
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

        console.log('OCR Result:', text);
        await addScreenshot(timestamp, URL.createObjectURL(imageBlob), text);

    } catch (error) {
        console.error('OCR Error:', error);
    }
}

export {
    performOCR
};
