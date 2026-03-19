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
    const { name, category, mimeType, inlineData, size, date } = req.body;
    
    if (!inlineData) {
      return res.status(400).json({ error: "No file data provided" });
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

// Gemini Chat API (Server-side for security)
app.post("/api/chat", async (req, res) => {
  try {
    const { query, activeFiles } = req.body;
    
    // 1. Get Key from Environment Variable
    const envKeys = (process.env.GEMINI_API_KEY || "")
      .split(',')
      .map(k => k.trim())
      .filter(k => k !== "");
    
    if (envKeys.length === 0) {
      return res.status(500).json({ error: "Missing Gemini API Key in Vercel Environment Variables." });
    }

    const apiKey = envKeys[Math.floor(Math.random() * envKeys.length)];
    const ai = new GoogleGenAI({ apiKey });

    let textContext = "ข้อมูลเอกสารของคลินิกที่เป็นข้อความ:\n";
    let mediaParts = [];
    let hasText = false;

    for (const file of activeFiles) {
      let fileData = null;
      
      // If file has inlineData (small files), use it
      if (file.inlineData) {
        fileData = file.inlineData;
      } else if (file.url) {
        // Fetch from Blob if not inline
        try {
          const resp = await fetch(file.url);
          const arrayBuffer = await resp.arrayBuffer();
          fileData = Buffer.from(arrayBuffer).toString('base64');
        } catch (e) {
          console.error(`Error fetching file ${file.name}:`, e);
        }
      }

      if (fileData && file.mimeType && (file.mimeType.startsWith('image/') || file.mimeType.startsWith('audio/') || file.mimeType.startsWith('video/') || file.mimeType === 'application/pdf')) {
        mediaParts.push({
          inlineData: {
            mimeType: file.mimeType,
            data: fileData
          }
        });
        textContext += `\n[แนบไฟล์ Media/PDF: ${file.name}]`;
        hasText = true;
      } else if (file.content) {
        textContext += `--- เริ่มเอกสาร: ${file.name} ---\n${file.content}\n--- จบเอกสาร: ${file.name} ---\n\n`;
        hasText = true;
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

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: requestParts }],
      config: {
        systemInstruction: `คุณคือผู้ช่วย AI ของคลินิก หน้าที่ของคุณคือตอบคำถามของผู้ใช้งานโดยอ้างอิงจาก "ข้อมูลเอกสารของคลินิก" (ซึ่งอาจเป็นข้อความ, PDF, รูปภาพ, วีดีโอ หรือเสียง) ที่แนบมาให้เท่านั้น ห้ามคิดเอาเอง หรือใช้ความรู้นอกเหนือจากที่ให้ไปโดยเด็ดขาด
        
การจัดรูปแบบคำตอบ (Formatting):
- ใช้ Markdown ในการตอบเพื่อให้ดูสวยงามและอ่านง่าย
- **เน้นคำที่สำคัญ** หรือตัวเลขที่สำคัญด้วยตัวหนา (Bold) เช่น **ราคา 500 บาท**, **เปิด 8:30 น.**
- ใช้รายการแบบจุด (Bullet points) หรือลำดับตัวเลขสำหรับข้อมูลที่เป็นรายการ
- ใช้ตาราง (Table) หากข้อมูลมีความซับซ้อนและต้องการเปรียบเทียบ
- เว้นวรรคและขึ้นบรรทัดใหม่ให้เหมาะสมเพื่อให้อ่านง่ายบนมือถือ

กฎเกณฑ์:
1. การตอบคำถาม: ให้ตอบอย่าง "สั้น กระชับ และเข้าใจง่าย" (Concise and Clear) หลีกเลี่ยงการใช้คำฟุ่มเฟือย
2. หากคำถามเป็นเรื่องการวินิจฉัยโรค สั่งยา หรืออาการเจ็บป่วย ให้กำหนด status เป็น "out_of_scope" และแนะนำให้พบแพทย์
3. หากคำถามกำกวม หรือกว้างเกินไป (Broad/Ambiguous) เช่น "มีอะไรบ้าง", "ราคาเท่าไหร่" (โดยไม่ระบุบริการ), "ขอข้อมูลหน่อย" ให้กำหนด status เป็น "clarification_needed" และตอบกลับโดยขอให้ผู้ใช้ระบุสิ่งที่ต้องการทราบให้ชัดเจนยิ่งขึ้น เช่น "ต้องการทราบราคาของบริการใดเป็นพิเศษครับ?" หรือ "ต้องการข้อมูลในส่วนไหนครับ?"
4. หากข้อมูลในเอกสารขัดแย้งกันเอง ให้กำหนด status เป็น "conflict_detected"
5. หากค้นหาในเอกสารที่แนบไปทั้งหมดแล้ว "ไม่พบข้อมูลเลย" ให้กำหนด status เป็น "no_answer"
6. หากตอบได้ ให้กำหนด status เป็น "answered" พร้อมใส่ชื่อไฟล์ที่ใช้อ้างอิงลงใน array citations`,
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["answered", "no_answer", "clarification_needed", "out_of_scope", "conflict_detected"] },
            short_answer: { type: Type.STRING, description: "คำตอบแบบสั้นๆ หรือสรุป" },
            answer: { type: Type.STRING, description: "คำตอบแบบละเอียด หรือคำถามเพื่อขอความชัดเจน" },
            confidence: { type: Type.NUMBER, description: "ความมั่นใจ 0-1" },
            citations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  file_name: { type: Type.STRING },
                  locator: { type: Type.STRING, description: "ระบุตำแหน่งคร่าวๆ เช่น หน้า 2, นาทีที่ 1:20" }
                }
              }
            }
          },
          required: ["status", "answer"]
        }
      }
    });

    if (response.text) {
      res.json(JSON.parse(response.text));
    } else {
      throw new Error("Empty response from AI");
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
