import express from "express";
import { put, del } from "@vercel/blob";
import { createClient } from "@vercel/kv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize KV with fallback for different environment variable names
const hasKVConfig = (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) || 
                   (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
                   (process.env.KV_URL);

const hasBlobConfig = !!process.env.BLOB_READ_WRITE_TOKEN;

// In-memory fallback for development without KV
const memoryStore: Record<string, any> = {
  "clinic_files_ids": [],
  "clinic_categories": [
    { id: "cat_1", name: "ข้อมูลทั่วไป" },
    { id: "cat_2", name: "ระเบียบการคลินิก" }
  ],
  "clinic_gemini_keys": []
};

const kv = hasKVConfig ? createClient({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "",
}) : {
  get: async (key: string) => memoryStore[key] || null,
  set: async (key: string, value: any) => { memoryStore[key] = value; return "OK"; },
  del: async (key: string) => { delete memoryStore[key]; return 1; },
};

// Mock Blob put/del
const mockPut = async (name: string, buffer: Buffer, options: any) => {
  console.log(`Mock Upload: ${name}`);
  const base64 = buffer.toString('base64');
  return {
    url: `data:${options.contentType};base64,${base64}`,
    downloadUrl: `data:${options.contentType};base64,${base64}`,
    pathname: name,
    contentType: options.contentType,
    contentDisposition: ''
  };
};

const mockDel = async (url: string) => {
  console.log(`Mock Delete: ${url}`);
  return;
};

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// API Routes

// Helper to check environment variables
const checkEnv = () => {
  // We no longer block if KV or Blob is missing because we have fallbacks
  return [];
};

// Fetch all data (files and categories)
app.get("/api/data", async (req, res) => {
  const missing = checkEnv();
  if (missing.length > 0) {
    return res.status(500).json({ 
      error: `Missing Environment Variables: ${missing.join(", ")}`,
      details: "Please ensure you have clicked 'Connect' in the Vercel Storage tab for both KV and Blob, then Redeploy."
    });
  }
  try {
    const fileIds: string[] = await kv.get("clinic_files_ids") || [];
    const files = [];
    
    // Fetch each file metadata in parallel
    if (fileIds.length > 0) {
      const filePromises = fileIds.map(id => kv.get(`clinic_file:${id}`));
      const results = await Promise.all(filePromises);
      files.push(...results.filter(f => f !== null));
    }

    const categories = await kv.get("clinic_categories") || [];
    const geminiKeys = await kv.get("clinic_gemini_keys") || [];
    res.json({ files, categories, geminiKeys });
  } catch (error: any) {
    console.error("KV Error:", error);
    res.status(500).json({ error: "KV Connection Error", message: error.message });
  }
});

// Save categories
app.post("/api/categories", async (req, res) => {
  const missing = checkEnv();
  if (missing.length > 0) return res.status(500).json({ error: `Missing: ${missing.join(", ")}` });
  
  try {
    const { categories } = req.body;
    if (!Array.isArray(categories)) {
      return res.status(400).json({ error: "Invalid categories format. Expected an array." });
    }
    await kv.set("clinic_categories", categories);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to save categories", message: error.message });
  }
});

// Save Gemini API Keys
app.post("/api/keys", async (req, res) => {
  const missing = checkEnv();
  if (missing.length > 0) return res.status(500).json({ error: `Missing: ${missing.join(", ")}` });
  
  try {
    const { keys } = req.body;
    await kv.set("clinic_gemini_keys", keys);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to save API keys", message: error.message });
  }
});

// Upload file to Vercel Blob and save metadata to KV
app.post("/api/upload", async (req, res) => {
  const missing = checkEnv();
  if (missing.length > 0) {
    return res.status(500).json({ 
      error: "Configuration Missing", 
      message: `Missing variables: ${missing.join(", ")}. Please connect Storage in Vercel dashboard.` 
    });
  }

  try {
    const { name, category, mimeType, inlineData, size, date, content } = req.body;
    
    if (!inlineData || typeof inlineData !== 'string') {
      return res.status(400).json({ error: "No valid file data provided" });
    }

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: "No valid file name provided" });
    }

    // 1. Upload to Vercel Blob
    const buffer = Buffer.from(inlineData, 'base64');
    
    // Use real put if config exists, otherwise use mock
    const blob = hasBlobConfig ? await put(name, buffer, {
      contentType: mimeType,
      access: 'public',
      // @ts-ignore - Some versions of the SDK might not have this in types but the API supports it
      contentLength: buffer.length,
      addRandomSuffix: true
    }) : await mockPut(name, buffer, { contentType: mimeType });

    // 2. Save metadata to individual KV key and update ID list
    const fileId = `file_${Date.now()}`;
    const newFile = {
      id: fileId,
      name,
      category,
      status: 'active',
      date,
      size,
      url: blob.url,
      mimeType,
      content: content || null,
      inlineData: inlineData.length < 1000000 ? inlineData : null
    };
    
    await kv.set(`clinic_file:${fileId}`, newFile);
    
    const fileIds: string[] = await kv.get("clinic_files_ids") || [];
    fileIds.unshift(fileId);
    await kv.set("clinic_files_ids", fileIds);
    
    res.json(newFile);
  } catch (error: any) {
    console.error("Upload Error:", error);
    res.status(500).json({ 
      error: "Vercel Storage Error", 
      message: error.message || "Failed to upload to Blob or save to KV" 
    });
  }
});

// Delete file
app.delete("/api/files/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const fileToDelete: any = await kv.get(`clinic_file:${id}`);
    
    if (fileToDelete?.url) {
      if (hasBlobConfig && !fileToDelete.url.startsWith('data:')) {
        await del(fileToDelete.url);
      } else {
        await mockDel(fileToDelete.url);
      }
    }
    
    await kv.del(`clinic_file:${id}`);
    
    const fileIds: string[] = await kv.get("clinic_files_ids") || [];
    const updatedFileIds = fileIds.filter(fid => fid !== id);
    await kv.set("clinic_files_ids", updatedFileIds);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// Toggle file status
app.post("/api/files/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const file: any = await kv.get(`clinic_file:${id}`);
    if (file) {
      file.status = file.status === 'active' ? 'inactive' : 'active';
      await kv.set(`clinic_file:${id}`, file);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to update status" });
  }
});

// In-memory cache for file contents to reduce Blob/KV calls
const fileContentCache: Record<string, { data: string, timestamp: number }> = {};
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Basic text chunking for large documents
const chunkText = (text: string, maxChunkSize: number = 4000) => {
  if (text.length <= maxChunkSize) return [text];
  const chunks = [];
  let currentPos = 0;
  while (currentPos < text.length) {
    chunks.push(text.substring(currentPos, currentPos + maxChunkSize));
    currentPos += maxChunkSize - 200; // 200 character overlap
  }
  return chunks;
};

// Gemini Chat API (Server-side for security)
app.post("/api/chat", async (req, res) => {
  try {
    const { query, activeFiles } = req.body;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: "Invalid query provided." });
    }

    if (!Array.isArray(activeFiles)) {
      return res.status(400).json({ error: "Invalid activeFiles format. Expected an array." });
    }
    
    // 1. Get all Keys from Environment Variable and KV Store
    const envKeys = (process.env.GEMINI_API_KEY || "")
      .split(',')
      .map(k => k.trim())
      .filter(k => k !== "");
      
    const kvKeys = await kv.get("clinic_gemini_keys") || [];
    const allKeys = [...new Set([...envKeys, ...(Array.isArray(kvKeys) ? kvKeys : [])])].filter(k => k && typeof k === 'string');
    
    if (allKeys.length === 0) {
      return res.status(500).json({ error: "Missing Gemini API Key. Please add it in Vercel Environment Variables or Admin Panel." });
    }

    // Shuffle keys to distribute load
    const shuffledKeys = [...allKeys].sort(() => Math.random() - 0.5);
    
    // Prepare data once before trying different API keys
    const processedFiles = await Promise.all(activeFiles.map(async (file: any) => {
      // Check cache first
      const cacheKey = `content_${file.id}`;
      if (fileContentCache[cacheKey] && (Date.now() - fileContentCache[cacheKey].timestamp < CACHE_TTL)) {
        return { ...file, fileData: fileContentCache[cacheKey].data };
      }

      let fileData = null;
      if (file.inlineData) {
        fileData = file.inlineData;
      } else if (file.url) {
        try {
          const resp = await fetch(file.url);
          const arrayBuffer = await resp.arrayBuffer();
          fileData = Buffer.from(arrayBuffer).toString('base64');
          
          // Cache the data
          fileContentCache[cacheKey] = { data: fileData, timestamp: Date.now() };
        } catch (e) {
          console.error(`Error fetching file ${file.name}:`, e);
        }
      }
      return { ...file, fileData };
    }));

    let lastError = null;

    // Prepare context once with chunking for large text
    let textContext = "ข้อมูลเอกสารของคลินิก:\n";
    let mediaParts = [];
    let hasText = false;

    for (const file of processedFiles) {
      const isMultimodal = file.mimeType && (
        file.mimeType.startsWith('image/') || 
        file.mimeType.startsWith('audio/') || 
        file.mimeType.startsWith('video/') || 
        file.mimeType === 'application/pdf'
      );

      if (isMultimodal) {
        if (file.fileData) {
          mediaParts.push({
            inlineData: { mimeType: file.mimeType, data: file.fileData }
          });
        }
        if (file.content) {
          const chunks = chunkText(file.content, 3000);
          textContext += `--- เนื้อหาจากไฟล์ ${file.name} ---\n${chunks[0]}\n\n`; // Use first chunk for context if too large
        } else {
          textContext += `\n[แนบไฟล์สื่อ: ${file.name}]`;
        }
        hasText = true;
      } else {
        if (file.content) {
          const chunks = chunkText(file.content, 5000);
          textContext += `--- เนื้อหาเอกสาร: ${file.name} ---\n${chunks.join('\n[...]\n')}\n\n`;
          hasText = true;
        }
      }
    }

    if (!hasText && mediaParts.length === 0) {
      textContext = "ไม่มีข้อมูลเอกสารในระบบขณะนี้";
    }

    const requestParts = [];
    if (hasText || mediaParts.length === 0) {
      requestParts.push({ text: textContext });
    }
    requestParts.push(...mediaParts);
    requestParts.push({ text: `คำถาม: ${query}` });

    let headersSent = false;

    const modelsToTry = [
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-flash-latest"
    ];

    // Try each model and each key until one works or all fail
    for (const modelName of modelsToTry) {
      for (const apiKey of shuffledKeys) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          
          const responseStream = await ai.models.generateContentStream({
            model: modelName,
            contents: [{ role: "user", parts: requestParts }],
            config: {
              systemInstruction: `คุณคือผู้ช่วย AI ของคลินิก (เปรียบเสมือนพยาบาลหรือเจ้าหน้าที่คลินิกที่มีความใส่ใจ เป็นมิตร และน่าเชื่อถือ) และมีบทบาทเป็น "แพทย์ผู้เชี่ยวชาญด้านวัคซีนและภูมิคุ้มกันวิทยา"
              
      รูปแบบและน้ำเสียงการตอบ (Format & Tone):
      - น้ำเสียงสุภาพ เป็นมิตร มีความเห็นอกเห็นใจ (Empathy) และน่าเชื่อถือ ใช้คำลงท้าย "ค่ะ/ครับ" เสมอ
      - กระชับและแบ่งวรรคตอนให้อ่านง่าย (เหมาะสำหรับอ่านบนหน้าจอมือถือ) หลีกเลี่ยงข้อความที่ยาวติดกันเป็นพรืด
      - ใช้สัญลักษณ์ (Bullet Points) เพื่อความชัดเจน ในการแจกแจงรายการ เช่น ราคาวัคซีน, เงื่อนไขผู้ที่มีสิทธิ์ฉีด, หรือผลข้างเคียง
      - **เน้นคำที่สำคัญ** หรือตัวเลขที่สำคัญด้วยตัวหนา (Bold)
      
      แหล่งข้อมูลในการตอบคำถาม (สำคัญมาก):
      1. ข้อมูลบริการของคลินิก (ราคา, โปรโมชั่น, เวลาทำการ, เงื่อนไขการรับบริการ): **ต้องอ้างอิงจาก "ข้อมูลเอกสารของคลินิก" ที่แนบมาให้เท่านั้น** ห้ามคิดคำตอบเองเด็ดขาด
      2. ความรู้ทางการแพทย์เรื่องวัคซีน: อนุญาตให้ใช้ความรู้ทางการแพทย์ระดับผู้เชี่ยวชาญเพื่ออธิบายสรรพคุณ, ผลข้างเคียง, ข้อห้ามใช้, กลไกการออกฤทธิ์, หรือคำแนะนำตามช่วงวัย
      
      เนื้อหาที่ต้องมี (Content Rules):
      1. การตอบตรงตามเอกสาร (Strict Grounding): หากข้อมูลบริการของคลินิกไม่มีในเอกสาร ให้ตอบตามตรงว่า "ไม่มีข้อมูลในส่วนนี้" หรือ "กรุณาสอบถามเจ้าหน้าที่" ห้ามเดาหรือแต่งเติมข้อมูลบริการเองเด็ดขาด
      2. ข้อมูลจำเป็นพื้นฐาน: หากผู้ใช้ถามกว้างๆ ควรให้ข้อมูลที่จำเป็นครบถ้วน เช่น ชนิดของวัคซีน, ราคา, จำนวนเข็มที่ต้องฉีด, และระยะห่างระหว่างเข็ม
      3. เงื่อนไขและข้อห้าม (Contraindications): หากวัคซีนตัวนั้นมีข้อห้ามสำหรับคนบางกลุ่ม (เช่น หญิงตั้งครรภ์, ผู้แพ้ยาบางชนิด) หรือมีเงื่อนไขเรื่องอายุ ให้เน้นย้ำข้อมูลส่วนนี้ให้เด่นชัด และปฏิเสธอย่างสุภาพหากผู้ใช้ไม่ตรงเงื่อนไข
      4. คำเตือนทางการแพทย์ (Medical Disclaimer): หากมีการให้คำแนะนำด้านสุขภาพ ต้องมีข้อความสงวนสิทธิ์สั้นๆ เช่น "ข้อมูลนี้เป็นเพียงข้อมูลเบื้องต้น หากท่านมีโรคประจำตัว กรุณาปรึกษาแพทย์ก่อนรับวัคซีน"
      5. นโยบายการเข้ารับบริการ (Walk-in Only): **คลินิกให้บริการแบบ Walk-in เท่านั้น ไม่มีการนัดหมายล่วงหน้า** ห้ามเสนอให้ผู้ใช้จองคิวหรือนัดหมายแพทย์โดยเด็ดขาด หากผู้ใช้ถามเรื่องการจองคิว ให้แจ้งว่าสามารถเข้ามาติดต่อที่คลินิกได้เลย
      6. การแจ้งเวลาทำการ: ทุกครั้งที่มีการแจ้ง **เวลาทำการของคลินิก** จะต้องแจ้ง **เวลาปิดรับบัตร** ควบคู่ไปด้วยเสมอ (อ้างอิงเวลาปิดรับบัตรจากเอกสารของคลินิก)
      7. Call to Action: ปิดท้ายด้วยข้อความนี้เสมอ "ต้องการสอบถามข้อมูลอื่นเพิ่มไหมคะ" หรือ "ต้องการสอบถามข้อมูลอื่นเพิ่มไหมครับ"
      
      กฎเกณฑ์การประมวลผล (Processing Rules):
      - การวินิจฉัย/การแพทย์: หากคำถามเป็นเรื่องการวินิจฉัยโรค สั่งยา หรืออาการเจ็บป่วยฉุกเฉิน ให้กำหนด status เป็น "out_of_scope" และแนะนำให้พบแพทย์ทันที
      - การตรวจจับความกำกวม: หากคำถามกว้างเกินไป ให้กำหนด status เป็น "clarification_needed" และถามกลับอย่างสุภาพ
      - ตอบคำถามได้: หากตอบได้ชัดเจน ให้กำหนด status เป็น "answered" พร้อมใส่ชื่อไฟล์ที่ใช้อ้างอิงลงใน array citations
      
      ขั้นตอนการตรวจสอบ (Self-Correction ก่อนตอบ):
      - ตรวจสอบว่ามีคำลงท้าย ค่ะ/ครับ หรือไม่?
      - ตรวจสอบว่ามีการแบ่งวรรคตอนและใช้ Bullet points หรือไม่?
      - ตรวจสอบว่ามี Medical Disclaimer และปิดท้ายด้วย "ต้องการสอบถามข้อมูลอื่นเพิ่มไหมคะ/ครับ" หรือไม่?
      - หากมีการแจ้งเวลาทำการ ได้แจ้งเวลาปิดรับบัตรด้วยหรือไม่?
      - ข้อมูลราคาและบริการมาจากเอกสารจริงหรือไม่?`,
              temperature: 0.0,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  status: { type: Type.STRING, enum: ["answered", "no_answer", "clarification_needed", "out_of_scope", "conflict_detected"] },
                  short_answer: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  missing_fields: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "รายการข้อมูลที่ขาดหายไปหรือต้องการความชัดเจนเพิ่ม"
                  },
                  citations: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        file_name: { type: Type.STRING },
                        locator: { type: Type.STRING }
                      }
                    }
                  }
                },
                required: ["status", "answer"]
              }
            }
          });

          // Setup SSE for streaming
          if (!headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx
            headersSent = true;
          }

          for await (const chunk of responseStream) {
            if (chunk.text) {
              res.write(`data: ${JSON.stringify({ chunk: chunk.text })}\n\n`);
            }
          }
          
          res.write(`data: [DONE]\n\n`);
          res.end();
          return; // Success! Exit the loop and function

        } catch (error: any) {
          lastError = error;
          const errorMsg = error.message || "";
          
          if (headersSent) {
            // If headers are already sent, we cannot try another key or send a 500 status.
            // We must just end the stream with an error message.
            console.error(`API Error during streaming with model ${modelName}:`, errorMsg);
            res.write(`data: ${JSON.stringify({ chunk: "\n\n[ข้อผิดพลาด: การเชื่อมต่อถูกตัดขาดชั่วคราว]" })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
            return;
          }

          if (errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota") || errorMsg.toLowerCase().includes("too many requests")) {
            console.warn(`API Key quota exceeded for model ${modelName}, trying next key/model...`);
            continue;
          } else {
            console.error(`API Error with current key for model ${modelName}:`, errorMsg);
            continue;
          }
        }
      }
    }

    // If we get here, all keys failed
    if (!headersSent) {
      res.status(500).json({ error: "All API keys failed or were exhausted." });
    }
  } catch (error: any) {
    console.error("Gemini API error:", error);
    res.status(500).json({
      status: "system_error",
      answer: "ขออภัยครับ ระบบเชื่อมต่อ AI มีปัญหาชั่วคราว"
    });
  }
});

async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

setupVite();

if (process.env.VERCEL !== '1') {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
