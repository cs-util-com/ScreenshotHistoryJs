async function generateSummary(ocrText, timestamps) {
    console.log('Generating summary for:', ocrText, timestamps);

    try {
        // Direct imports from CDN with specific versions
        const {
            ChatOpenAI
        } = await import("https://cdn.jsdelivr.net/npm/@langchain/openai@0.0.14/+esm");
        const {
            HumanMessage,
            SystemMessage
        } = await import("https://cdn.jsdelivr.net/npm/@langchain/core@0.1.17/messages/+esm");

        const apiKey = localStorage.getItem('openai_api_key'); // Retrieve API key from local storage

        if (!apiKey) {
            console.warn('OpenAI API key not found. Please enter it in the settings.');
            return;
        }

        const model = new ChatOpenAI({
            openAIApiKey: apiKey,
            modelName: "gpt-3.5-turbo", // Or another suitable model
            maxTokens: 500,
        });

        const systemMessage = new SystemMessage(
            "You are a helpful assistant that summarizes text."
        );
        const humanMessage = new HumanMessage(
            `Please summarize the following text:\n${ocrText}`
        );

        const response = await model.call([systemMessage, humanMessage]);
        console.log('Summary:', response.content);

        // TODO: Store the summary in Dexie
    } catch (error) {
        console.error('Error generating summary:', error);
    }
}

export {
    generateSummary
};
