import express from "express";
import { put, del } from "@vercel/blob";
import { createClient } from "@vercel/kv";
import path from "path";
import { fileURLToPath } from "url";

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
