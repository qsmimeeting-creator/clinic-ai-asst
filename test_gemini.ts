import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: {
        parts: [
          { text: "Hello" }
        ]
      }
    });
    console.log("Success:", result.text);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
