import express from "express";
import "dotenv/config";
import { put, del } from "@vercel/blob";
import { createClient } from "@vercel/kv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Gemini AI
const getAI = (apiKey: string) => new GoogleGenAI({ apiKey });

// Helper for Cosine Similarity
function cosineSimilarity(vecA: number[], vecB: number[]) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

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
  ]
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

// In-memory cache for metadata to speed up /api/data
let metadataCache: { data: any, timestamp: number } | null = null;
const METADATA_CACHE_TTL = 30000; // 30 seconds

// Fetch all data (files and categories)
app.get("/api/data", async (req, res) => {
  try {
    // Check cache
    if (metadataCache && (Date.now() - metadataCache.timestamp < METADATA_CACHE_TTL)) {
      return res.json(metadataCache.data);
    }

    const fileIds: string[] = await kv.get("clinic_files_ids") || [];
    const files = [];
    
    // Fetch each file metadata in parallel
    if (fileIds.length > 0) {
      // Limit to last 100 files for performance if the list is huge
      const recentIds = fileIds.slice(0, 100);
      
      // Fetch in batches but in PARALLEL to speed up loading
      const batchSize = 20; // Increased batch size
      const batchPromises = [];
      
      for (let i = 0; i < recentIds.length; i += batchSize) {
        const batch = recentIds.slice(i, i + batchSize);
        batchPromises.push((async () => {
          const kvAny = kv as any;
          if (typeof kvAny.mget === 'function') {
            const keys = batch.map(id => `clinic_file:${id}`);
            return await kvAny.mget(...keys);
          } else {
            const filePromises = batch.map(id => kv.get(`clinic_file:${id}`));
            return await Promise.all(filePromises);
          }
        })());
      }
      
      const batchResults = await Promise.all(batchPromises);
      const results = batchResults.flat();
      
      files.push(...results.filter(f => f !== null).map((f: any) => {
        // Strip large fields to save bandwidth and prevent timeouts
        const { inlineData, content, embedding, ...rest } = f;
        if (rest.url && rest.url.startsWith('data:')) {
          rest.url = null; // Strip data URI
        }
        return rest;
      }));
    }

    const categories = await kv.get("clinic_categories") || [];
    const responseData = { files, categories, totalFiles: fileIds.length };
    
    // Update cache
    metadataCache = { data: responseData, timestamp: Date.now() };
    
    res.json(responseData);
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
    metadataCache = null; // Invalidate cache
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to save categories", message: error.message });
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
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Store metadata separately from large content to keep list fetching fast
    const fileMeta = {
      id: fileId,
      name,
      category,
      status: 'active',
      date,
      size,
      url: blob.url,
      mimeType
    };

    const fileData = {
      id: fileId,
      content: content || null,
      embedding: null,
      inlineData: inlineData.length < 500000 ? inlineData : null
    };
    
    // Save metadata and data in parallel
    // We store metadata in 'clinic_file:' and full data in 'clinic_file_content:'
    // This keeps the metadata fetch fast and avoids the 10MB limit
    await Promise.all([
      kv.set(`clinic_file:${fileId}`, fileMeta),
      kv.set(`clinic_file_content:${fileId}`, { ...fileMeta, ...fileData }),
    ]);
    
    // Use atomic lpush if available, otherwise fallback
    const kvAny = kv as any;
    try {
      if (typeof kvAny.lpush === 'function') {
        await kvAny.lpush("clinic_files_ids", fileId);
      } else {
        const fileIds: string[] = await kv.get("clinic_files_ids") || [];
        fileIds.unshift(fileId);
        await kv.set("clinic_files_ids", fileIds);
      }
    } catch (lpushError) {
      console.error("LPUSH failed, falling back to set:", lpushError);
      const fileIds: string[] = await kv.get("clinic_files_ids") || [];
      fileIds.unshift(fileId);
      await kv.set("clinic_files_ids", fileIds);
    }
    
    metadataCache = null; // Invalidate cache
    res.json(fileMeta);
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
    await kv.del(`clinic_file_content:${id}`);
    
    const fileIds: string[] = await kv.get("clinic_files_ids") || [];
    const updatedFileIds = fileIds.filter(fid => fid !== id);
    await kv.set("clinic_files_ids", updatedFileIds);
    
    metadataCache = null; // Invalidate cache
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
      
      // Also update the content key if it exists
      const fullData: any = await kv.get(`clinic_file_content:${id}`);
      if (fullData) {
        fullData.status = file.status;
        await kv.set(`clinic_file_content:${id}`, fullData);
      }
      metadataCache = null; // Invalidate cache
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to update status" });
  }
});

// Download file
app.get("/api/files/:id/download", async (req, res) => {
  try {
    const { id } = req.params;
    // Try to fetch from the new 'content' key first, fallback to metadata key
    let file: any = await kv.get(`clinic_file_content:${id}`);
    if (!file) {
      file = await kv.get(`clinic_file:${id}`);
    }
    
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }
    
    if (file.url && file.url.startsWith('data:')) {
      // Return the data URI directly as a file download
      const [header, base64] = file.url.split(',');
      const mimeType = header.split(':')[1].split(';')[0];
      const buffer = Buffer.from(base64, 'base64');
      
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
      return res.send(buffer);
    } else if (file.url) {
      // Redirect to the real URL
      return res.redirect(file.url);
    } else if (file.inlineData) {
      // Fallback to inlineData if url is missing
      const buffer = Buffer.from(file.inlineData, 'base64');
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
      return res.send(buffer);
    } else {
      return res.status(404).json({ error: "File content not found" });
    }
  } catch (error: any) {
    res.status(500).json({ error: "Failed to download file", message: error.message });
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

// Optimize all files (generate missing embeddings)
app.post("/api/admin/optimize-files", async (req, res) => {
  try {
    const fileIds: string[] = await kv.get("clinic_files_ids") || [];
    if (fileIds.length === 0) return res.json({ message: "No files to optimize", count: 0 });

    const envKeys = (process.env.GEMINI_API_KEY || "").split(',').map(k => k.trim()).filter(k => k !== "");
    if (envKeys.length === 0) return res.status(500).json({ error: "Missing API Key" });
    
    const ai = new GoogleGenAI({ apiKey: envKeys[0] });
    let optimizedCount = 0;

    for (const id of fileIds) {
      // Try to fetch from the new 'content' key first, fallback to metadata key
      let file: any = await kv.get(`clinic_file_content:${id}`);
      if (!file) {
        file = await kv.get(`clinic_file:${id}`);
      }
      if (!file) continue;

      let updated = false;
      
      // Extract content if missing (especially for PDFs and Images)
      const isImage = file.mimeType && file.mimeType.startsWith('image/');
      const isPDF = file.mimeType === 'application/pdf';
      
      if (!file.content && (isPDF || isImage)) {
        try {
          let fileData = file.inlineData;
          
          // If inlineData is missing (due to size limits), fetch from URL
          if (!fileData && file.url) {
            console.log(`Fetching file data from URL for optimization: ${file.name}`);
            const resp = await fetch(file.url);
            if (resp.ok) {
              const arrayBuffer = await resp.arrayBuffer();
              fileData = Buffer.from(arrayBuffer).toString('base64');
            }
          }
          
          if (fileData) {
            const prompt = isPDF
              ? "Extract all text from this document accurately. Output only the text content."
              : "Extract all text from this image accurately. If it's a document or contains text, transcribe it. Output only the text content.";

            const result = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: {
                parts: [
                  { inlineData: { data: fileData, mimeType: file.mimeType } },
                  { text: prompt }
                ]
              }
            });
            if (result.text) {
              file.content = result.text;
              updated = true;
            }
          }
        } catch (e) {
          console.error(`Text extraction failed for ${file.name}:`, e);
        }
      }
      
      // Generate embedding if missing
      if (!file.embedding && file.content && file.content.length > 5) {
        try {
          console.log(`Generating embedding for: ${file.name}`);
          const result = await ai.models.embedContent({
            model: 'gemini-embedding-2-preview',
            contents: [file.content.substring(0, 10000)],
          });
          if (result.embeddings && result.embeddings.length > 0) {
            file.embedding = result.embeddings[0].values;
            updated = true;
            console.log(`Embedding generated successfully for: ${file.name}`);
          }
        } catch (e) {
          console.error(`Embedding failed for ${file.name}:`, e);
        }
      }

      if (updated) {
        // Store metadata separately from large content to keep list fetching fast
        const { content, embedding, inlineData, ...fileMeta } = file;
        await Promise.all([
          kv.set(`clinic_file:${id}`, fileMeta),
          kv.set(`clinic_file_content:${id}`, file),
        ]);
        optimizedCount++;
      }
      
      // Safety break to prevent timeout if we've processed too many files in one go
      // Vercel Hobby has 10s limit, Pro has 60s. 
      // Let's limit to processing 15 new files per click to be safe.
      if (optimizedCount >= 15) break;
    }

    metadataCache = null; // Invalidate cache
    res.json({ message: `Optimized ${optimizedCount} files`, count: optimizedCount });
  } catch (error: any) {
    console.error("Optimize Error:", error);
    res.status(500).json({ error: "Optimize Error", message: error.message });
  }
});

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
    
    // 1. Get all Keys from Environment Variable
    const envKeys = (process.env.GEMINI_API_KEY || "")
      .split(',')
      .map(k => k.trim())
      .filter(k => k !== "");
    
    if (envKeys.length === 0) {
      return res.status(500).json({ error: "Missing Gemini API Key in Vercel Environment Variables." });
    }

    // Shuffle keys to distribute load
    const shuffledKeys = [...envKeys].sort(() => Math.random() - 0.5);
    const primaryKey = shuffledKeys[0];
    const ai = new GoogleGenAI({ apiKey: primaryKey });

    // 1. Semantic Search / Retrieval (Phase 2: Query Time)
    // Embed the query
    let queryEmbedding = null;
    try {
      const embedResult = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: [query],
      });
      if (embedResult.embeddings && embedResult.embeddings.length > 0) {
        queryEmbedding = embedResult.embeddings[0].values;
      }
    } catch (e) {
      console.error("Query embedding failed:", e);
    }

    // 2. Fetch and Rank Files
    let allFilesRaw: any[] = [];
    const kvAny = kv as any;
    if (activeFiles.length > 0) {
      // Fetch metadata in batches to avoid 10MB limit
      const batchSize = 10;
      for (let i = 0; i < activeFiles.length; i += batchSize) {
        const batch = activeFiles.slice(i, i + batchSize);
        let batchResults = [];
        if (typeof kvAny.mget === 'function') {
          const keys = batch.map((f: any) => `clinic_file:${f.id}`);
          batchResults = await kvAny.mget(...keys);
        } else {
          batchResults = await Promise.all(batch.map((f: any) => kv.get(`clinic_file:${f.id}`)));
        }
        allFilesRaw.push(...batchResults);
      }
    }

    const allFiles = allFilesRaw.map((fullFile: any) => {
      if (!fullFile) return null;
      
      let score = 0;
      // Note: New files might not have embeddings in the metadata key
      if (queryEmbedding && fullFile.embedding) {
        score = cosineSimilarity(queryEmbedding, fullFile.embedding);
      }
      
      // Always do a keyword fallback to boost relevance or handle missing embeddings
      const q = query.toLowerCase();
      const keywords = q.split(/\s+/).filter(k => k.length > 1);
      
      // Check name
      const fileName = fullFile.name.toLowerCase();
      keywords.forEach(kw => {
        if (fileName.includes(kw)) score += 0.1;
      });
      if (fileName.includes(q)) score += 0.3;

      // Check content if available in metadata (for old files)
      if (fullFile.content) {
        const content = fullFile.content.toLowerCase();
        keywords.forEach(kw => {
          if (content.includes(kw)) score += 0.05;
        });
        if (content.includes(q)) score += 0.2;
      }
      
      return { ...fullFile, score };
    });

    // Filter and sort by relevance
    const topMetadata = allFiles
      .filter(f => f !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // Take top 5 most relevant files

    // Fetch full content for the top 5 relevant files
    const relevantFiles = await Promise.all(topMetadata.map(async (meta: any) => {
      // Try to fetch from the new 'content' key first
      const fullData: any = await kv.get(`clinic_file_content:${meta.id}`);
      if (fullData) {
        return { ...fullData, score: meta.score };
      }
      // Fallback to the metadata key (for old files that have everything in one key)
      return meta;
    }));

    // 3. Prepare context with ONLY relevant files
    let textContext = "ข้อมูลเอกสารที่เกี่ยวข้องของคลินิก:\n";
    let mediaParts = [];
    let hasRelevantContent = false;

    for (const file of relevantFiles) {
      const isMultimodal = file.mimeType && (
        file.mimeType.startsWith('image/') || 
        file.mimeType.startsWith('audio/') || 
        file.mimeType.startsWith('video/') || 
        file.mimeType === 'application/pdf'
      );

      if (isMultimodal) {
        // For multimodal, we only do this for the TOP 2 most relevant multimodal files to save bandwidth
        if (mediaParts.length < 2) {
          let fileData = file.inlineData;
          if (!fileData && file.url) {
            if (file.url.startsWith('data:')) {
              fileData = file.url.split(',')[1];
            } else {
              try {
                const resp = await fetch(file.url);
                const arrayBuffer = await resp.arrayBuffer();
                fileData = Buffer.from(arrayBuffer).toString('base64');
              } catch (e) {
                console.error(`Error fetching media ${file.name}:`, e);
              }
            }
          }
          
          if (fileData) {
            mediaParts.push({
              inlineData: { mimeType: file.mimeType, data: fileData }
            });
          }
        }
        
        if (file.content) {
          textContext += `--- เนื้อหาจากไฟล์ ${file.name} (ความเกี่ยวข้อง: ${Math.round(file.score * 100)}%) ---\n${file.content.substring(0, 3000)}\n\n`;
        }
        hasRelevantContent = true;
      } else {
        if (file.content) {
          textContext += `--- เนื้อหาเอกสาร: ${file.name} (ความเกี่ยวข้อง: ${Math.round(file.score * 100)}%) ---\n${file.content.substring(0, 5000)}\n\n`;
          hasRelevantContent = true;
        }
      }
    }

    const requestParts = [];
    if (hasRelevantContent) {
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

    let lastError = null;

    // Try each model and each key until one works or all fail
    for (const modelName of modelsToTry) {
      for (const apiKey of shuffledKeys) {
        try {
          const currentAi = new GoogleGenAI({ apiKey });
          
          const responseStream = await currentAi.models.generateContentStream({
            model: modelName,
            contents: { parts: requestParts },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, // Phase 1: Reduce thinking latency
              systemInstruction: `คุณคือผู้ช่วย AI ของคลินิก (เปรียบเสมือนพยาบาลหรือเจ้าหน้าที่คลินิกที่มีความใส่ใจ เป็นมิตร และน่าเชื่อถือ) และมีบทบาทเป็น "แพทย์ผู้เชี่ยวชาญด้านวัคซีนและภูมิคุ้มกันวิทยา"
              
              ข้อมูลสำคัญของคลินิก (System Knowledge):
              - คลินิกรับบริการเฉพาะ Walk-in เท่านั้น (ไม่รับจองคิวล่วงหน้า)
              - ให้บริการปรึกษาเรื่องวัคซีนและภูมิคุ้มกันวิทยา
              
              เป้าหมายหลักของคุณ:
              1. ตอบคำถามผู้ป่วยอย่างถูกต้อง ชัดเจน เข้าใจง่าย และมีความเห็นอกเห็นใจ
              2. อ้างอิงข้อมูลจากเอกสารที่คัดเลือกมาให้ (Context) และข้อมูลสำคัญของคลินิก (System Knowledge)
              3. เมื่อมีการถามถึงวัคซีนชนิดใด ให้พยายามค้นหาราคาวัคซีนชนิดนั้นจากเอกสารและแจ้งราคาไปด้วยเสมอ
              4. หากข้อมูลในเอกสารไม่เพียงพอ ให้ตอบตามข้อมูล System Knowledge หากมี หรือตอบอย่างสุภาพว่า "ขออภัยค่ะ ข้อมูลที่ให้มาไม่เพียงพอที่จะตอบคำถามนี้ รบกวนติดต่อเจ้าหน้าที่คลินิกโดยตรงนะคะ"
              5. ห้ามให้คำแนะนำทางการแพทย์ที่อยู่นอกเหนือจากเอกสารเด็ดขาด
              
              รูปแบบการตอบ:
              - ใช้ภาษาไทยที่สุภาพ เป็นธรรมชาติ (มี ค่ะ/ครับ ตามความเหมาะสม)
              - จัดรูปแบบข้อความให้อ่านง่าย ใช้ Markdown (เช่น **ตัวหนา**, - Bullet points)
              - ระบุชื่อไฟล์ที่ใช้อ้างอิงในคำตอบด้วย (ถ้ามี)
              
              สำคัญมาก: ตอบกลับในรูปแบบ JSON ที่มีโครงสร้างดังนี้เท่านั้น:
              {
                "answer": "คำตอบของคุณที่จัดรูปแบบด้วย Markdown",
                "citations": [{"file_name": "ชื่อไฟล์อ้างอิง 1", "locator": "หน้า/หัวข้อ"}]
              }`,
              temperature: 0.1
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
            // Small delay to let the rate limit settle
            await new Promise(resolve => setTimeout(resolve, 500));
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
      res.status(500).json({ 
        error: "All API keys failed or were exhausted.",
        details: "โควตาการใช้งาน AI ของคุณเต็มแล้ว กรุณาเพิ่ม API Key ใน Vercel Dashboard หรือลองใหม่อีกครั้งภายหลัง"
      });
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
