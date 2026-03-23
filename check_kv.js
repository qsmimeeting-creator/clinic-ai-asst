import { kv } from '@vercel/kv';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const fileIds = await kv.get("clinic_files_ids") || [];
  console.log('File IDs:', fileIds);
}
run();
