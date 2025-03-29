import { addSummary } from './storage.js';

// Centralized constants for model configuration
const MODEL_CONFIG = {
    openai: {
        modelName: "gpt-3.5-turbo",
        maxTokens: 500
    },
    gemini: {
        model: "gemini-1.5-flash",
        maxOutputTokens: 500
    },
    claude: {
        model: "claude-3-sonnet-20240229",
        maxTokens: 500
    },
    local: {
        model: "llama3",
        maxTokens: 500
    }
};

async function generateSummary(ocrText, timestamps) {
    if (!ocrText || !timestamps || timestamps.length === 0) {
        console.warn('No text or timestamps provided for summarization');
        return null;
    }
    
    console.log(`Generating summary for ${timestamps.length} screenshots`);
    
    try {
        // Get the selected model provider
        const modelProvider = localStorage.getItem('modelProvider') || 'openai';
        
        // Format the timestamps for inclusion in the prompt
        const timeRange = `${timestamps[0]} to ${timestamps[timestamps.length - 1]}`;
        
        // Create a prompt that includes timestamps context
        const prompt = `Please summarize the following OCR text extracted from my screen between ${timeRange}:\n\n${ocrText}`;
        
        // Select the appropriate model function based on the provider
        const modelFunctions = {
            openai: useOpenAI,
            gemini: useGemini,
            claude: useClaude,
            local: useLocalModel
        };
        
        const summaryFunction = modelFunctions[modelProvider] || useOpenAI;
        const summary = await summaryFunction(prompt);
        
        if (summary) {
            // Store the summary in the database
            const startTime = timestamps[0];
            const endTime = timestamps[timestamps.length - 1];
            await addSummary(startTime, endTime, summary);
            return summary;
        }
        
    } catch (error) {
        console.error('Error generating summary:', error);
    }
    
    return null;
}

// Model-specific functions 
async function useOpenAI(prompt) {
    try {
        const {
            ChatOpenAI
        } = await import("https://cdn.jsdelivr.net/npm/@langchain/openai@0.0.14/+esm");
        const {
            HumanMessage,
            SystemMessage
        } = await import("https://cdn.jsdelivr.net/npm/@langchain/core@0.1.17/messages/+esm");

        const apiKey = localStorage.getItem('openaiApiKey');
        if (!apiKey) {
            console.warn('OpenAI API key not found. Please enter it in the settings.');
            return null;
        }

        const model = new ChatOpenAI({
            openAIApiKey: apiKey,
            modelName: MODEL_CONFIG.openai.modelName,
            maxTokens: MODEL_CONFIG.openai.maxTokens,
        });

        const systemMessage = new SystemMessage(
            "You are a helpful assistant that summarizes text from screen captures. Keep your summary concise and focused on key activities."
        );
        const humanMessage = new HumanMessage(prompt);

        const response = await model.call([systemMessage, humanMessage]);
        console.log('Summary generated with OpenAI');
        return response.content;
    } catch (error) {
        console.error('Error using OpenAI:', error);
        return null;
    }
}

async function useGemini(prompt) {
    try {
        const {
            ChatGoogleGenerativeAI
        } = await import("https://cdn.jsdelivr.net/npm/@langchain/google-genai@0.0.4/+esm");

        const apiKey = localStorage.getItem('geminiApiKey');
        if (!apiKey) {
            console.warn('Google Gemini API key not found. Please enter it in the settings.');
            return null;
        }

        const model = new ChatGoogleGenerativeAI({
            apiKey: apiKey,
            model: MODEL_CONFIG.gemini.model,
            maxOutputTokens: MODEL_CONFIG.gemini.maxOutputTokens,
        });

        const response = await model.invoke([
            { type: "human", text: prompt }
        ]);

        console.log('Summary generated with Google Gemini');
        return response.content;
    } catch (error) {
        console.error('Error using Gemini:', error);
        return null;
    }
}

async function useClaude(prompt) {
    try {
        const {
            ChatAnthropic
        } = await import("https://cdn.jsdelivr.net/npm/@langchain/anthropic@0.0.3/+esm");

        const apiKey = localStorage.getItem('claudeApiKey');
        if (!apiKey) {
            console.warn('Anthropic Claude API key not found. Please enter it in the settings.');
            return null;
        }

        const model = new ChatAnthropic({
            apiKey: apiKey,
            model: MODEL_CONFIG.claude.model,
            maxTokens: MODEL_CONFIG.claude.maxTokens,
        });

        const response = await model.invoke([
            { type: "human", text: prompt }
        ]);
        
        console.log('Summary generated with Claude');
        return response.content;
    } catch (error) {
        console.error('Error using Claude:', error);
        return null;
    }
}

async function useLocalModel(prompt) {
    try {
        const localModelUrl = localStorage.getItem('localModelUrl') || 'http://localhost:11434';
        
        const response = await fetch(`${localModelUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: MODEL_CONFIG.local.model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.7,
                    max_tokens: MODEL_CONFIG.local.maxTokens,
                }
            }),
        });
        
        if (!response.ok) {
            throw new Error(`Local LLM returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Summary generated with local model');
        return data.response;
    } catch (error) {
        console.error('Error using local model:', error);
        return null;
    }
}

export {
    generateSummary
};
