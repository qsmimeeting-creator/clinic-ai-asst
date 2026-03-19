import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, FileText, AlertTriangle, ShieldAlert, Info, ThumbsUp, ThumbsDown, Clock, Search, Settings, ArrowLeft, Upload, Trash2, Database, Activity, FileArchive, CheckCircle, Lock, X, Plus, Tag, Mic, Volume2, VolumeX, Image as ImageIcon, FileAudio, FileVideo } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

// --- REAL AI BACKEND (Using Gemini API with Context Stuffing & Multimodal) ---
const callGeminiAPI = async (query, activeFiles) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // 1. เตรียม Context จากไฟล์ทั้งหมดที่ Active อยู่ (แยกระหว่าง Text และ Media)
  let textContext = "ข้อมูลเอกสารของคลินิกที่เป็นข้อความ:\n";
  let mediaParts = [];
  let hasText = false;

  activeFiles.forEach(file => {
    if (file.inlineData && file.mimeType) {
      // สำหรับไฟล์ PDF, รูปภาพ, เสียง, วีดีโอ
      mediaParts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.inlineData
        }
      });
      textContext += `\n[แนบไฟล์ Media/PDF: ${file.name}]`;
      hasText = true;
    } else if (file.content) {
      // สำหรับ Text, CSV, และ Mock Office Files
      textContext += `--- เริ่มเอกสาร: ${file.name} ---\n${file.content}\n--- จบเอกสาร: ${file.name} ---\n\n`;
      hasText = true;
    }
  });

  if (!hasText && mediaParts.length === 0) {
    textContext = "ไม่มีข้อมูลเอกสารในระบบขณะนี้";
  }

  // 2. สร้าง Content Parts รวมข้อความและมีเดียเข้าด้วยกัน
  const requestParts = [];
  if (hasText || mediaParts.length === 0) {
    requestParts.push({ text: textContext });
  }
  // นำไฟล์มีเดียทั้งหมดใส่เข้าไปให้ AI วิเคราะห์
  requestParts.push(...mediaParts);
  // ใส่คำถามต่อท้าย
  requestParts.push({ text: `คำถาม: ${query}` });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: requestParts }],
      config: {
        systemInstruction: `คุณคือผู้ช่วย AI ของคลินิก หน้าที่ของคุณคือตอบคำถามของผู้ใช้งานโดยอ้างอิงจาก "ข้อมูลเอกสารของคลินิก" (ซึ่งอาจเป็นข้อความ, PDF, รูปภาพ, วีดีโอ หรือเสียง) ที่แนบมาให้เท่านั้น ห้ามคิดเอาเอง หรือใช้ความรู้นอกเหนือจากที่ให้ไปโดยเด็ดขาด
        
กฎเกณฑ์:
1. หากคำถามเป็นเรื่องการวินิจฉัยโรค สั่งยา หรืออาการเจ็บป่วย ให้กำหนด status เป็น "out_of_scope" และแนะนำให้พบแพทย์
2. หากคำถามกำกวม ให้กำหนด status เป็น "clarification_needed"
3. หากข้อมูลในเอกสารขัดแย้งกันเอง ให้กำหนด status เป็น "conflict_detected"
4. หากค้นหาในเอกสารที่แนบไปทั้งหมดแล้ว "ไม่พบข้อมูลเลย" ให้กำหนด status เป็น "no_answer"
5. หากตอบได้ ให้กำหนด status เป็น "answered" พร้อมใส่ชื่อไฟล์ที่ใช้อ้างอิงลงใน array citations`,
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["answered", "no_answer", "clarification_needed", "out_of_scope", "conflict_detected"] },
            short_answer: { type: Type.STRING, description: "คำตอบแบบสั้นๆ หรือสรุป" },
            answer: { type: Type.STRING, description: "คำตอบแบบละเอียด" },
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
      return JSON.parse(response.text);
    } else {
      throw new Error("Empty response from AI");
    }
  } catch (error) {
    console.error("Gemini API error:", error);
    return {
      status: "system_error",
      answer: "ขออภัยครับ ระบบเชื่อมต่อ AI มีปัญหาชั่วคราว"
    };
  }
};

// --- ADMIN COMPONENT ---
const AdminPanel = ({ files, setFiles, categories, setCategories }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState(categories[0]?.id || '');
  const [showSuccess, setShowSuccess] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '', type: 'alert', onConfirm: null });
  
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);

  const acceptedExtensions = ".pdf,.xls,.xlsx,.csv,.ppt,.pptx,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp,.tiff,.mp3,.wav,.m4a,.aac,.wma,.mp4,.avi,.mov,.mkv,.wmv,.flv,.mpeg";

  const closeModal = () => setModal({ ...modal, isOpen: false });

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const processUploadedFile = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    
    const textExts = ['txt', 'csv'];
    const officeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    const pdfExts = ['pdf'];
    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'tiff'];
    const audioExts = ['mp3', 'wav', 'm4a', 'aac', 'wma'];
    const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'mpeg'];

    if (textExts.includes(ext)) {
      const content = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsText(file);
      });
      
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            resolve(result.split(',')[1]);
          } else {
            reject(new Error('Failed to read file as base64'));
          }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });

      return { type: 'text', content, inlineData: base64Data, mimeType: 'text/plain' };
    } 
    else if (officeExts.includes(ext)) {
      return { 
        type: 'text', 
        content: `[ไฟล์เอกสาร Office: ${file.name}]\nหมายเหตุ: ระบบกำลังประมวลผลข้อมูลจากไฟล์นี้ (ในเวอร์ชันปัจจุบันรองรับการอ่านข้อความจากไฟล์ Text, CSV และไฟล์ Media/PDF เป็นหลัก)`,
        inlineData: '',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };
    } 
    else {
      let mimeType = file.type;
      
      if (!mimeType) {
        const mimeMap = {
          'pdf': 'application/pdf',
          'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'tiff': 'image/tiff',
          'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'aac': 'audio/aac', 'wma': 'audio/x-ms-wma',
          'mp4': 'video/mp4', 'avi': 'video/x-msvideo', 'mov': 'video/quicktime', 'mkv': 'video/x-matroska', 'wmv': 'video/x-ms-wmv', 'flv': 'video/x-flv', 'mpeg': 'video/mpeg'
        };
        mimeType = mimeMap[ext] || 'application/octet-stream';
      }

      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            resolve(result.split(',')[1]);
          } else {
            reject(new Error('Failed to read file as base64'));
          }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });

      return { type: 'media', mimeType: mimeType, inlineData: base64Data };
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setModal({ isOpen: true, title: 'แจ้งเตือน', message: 'กรุณาคลิกเพื่อเลือกไฟล์เอกสารก่อนทำการอัปโหลดครับ', type: 'alert' });
      return;
    }

    setIsUploading(true);
    
    try {
      const processedData = await processUploadedFile(selectedFile);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedFile.name,
          category: uploadCategory,
          mimeType: processedData.mimeType,
          inlineData: processedData.inlineData,
          size: (selectedFile.size / (1024 * 1024)).toFixed(2) + ' MB',
          date: new Date().toISOString().split('T')[0]
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || 'Upload failed');
      }
      
      setFiles([result, ...files]);
      setShowSuccess(true);
      
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error: any) {
      setModal({ 
        isOpen: true, 
        title: 'เกิดข้อผิดพลาด', 
        message: `ไม่สามารถอัปโหลดไฟล์ได้: ${error.message}`, 
        type: 'alert' 
      });
    } finally {
      setIsUploading(false);
    }
  };

  const toggleStatus = async (id) => {
    try {
      const response = await fetch(`/api/files/${id}/status`, { method: 'POST' });
      if (!response.ok) throw new Error('Toggle failed');
      setFiles(files.map(f => f.id === id ? { ...f, status: f.status === 'active' ? 'inactive' : 'active' } : f));
    } catch (error) {
      setModal({ isOpen: true, title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถเปลี่ยนสถานะไฟล์ได้', type: 'alert' });
    }
  };

  const deleteFile = async (id) => {
    setModal({
      isOpen: true,
      title: 'ยืนยันการลบเอกสาร',
      message: 'คุณแน่ใจหรือไม่ที่จะลบไฟล์นี้ออกจาก Vercel Storage? (ไม่สามารถกู้คืนได้)',
      type: 'confirm',
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/files/${id}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Delete failed');
          setFiles(files.filter(f => f.id !== id));
          closeModal();
        } catch (error) {
          setModal({ isOpen: true, title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถลบไฟล์ได้', type: 'alert' });
        }
      }
    });
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    const newId = `cat_${Date.now()}`;
    const newCategories = [...categories, { id: newId, name: newCategoryName.trim() }];
    
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: newCategories })
      });
      if (!response.ok) throw new Error('Failed to save categories');
      
      setCategories(newCategories);
      setNewCategoryName('');
      if (!uploadCategory) setUploadCategory(newId);
    } catch (error) {
      setModal({ isOpen: true, title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถบันทึกหมวดหมู่ได้', type: 'alert' });
    }
  };

  const handleDeleteCategory = async (id) => {
    const isUsed = files.some(f => f.category === id);
    if (isUsed) {
      setModal({
        isOpen: true,
        title: 'ไม่สามารถลบได้',
        message: 'ไม่สามารถลบหมวดหมู่นี้ได้ เนื่องจากมีเอกสารในระบบกำลังใช้งานอยู่ กรุณาลบเอกสารที่เกี่ยวข้องออกก่อนครับ',
        type: 'alert'
      });
      return;
    }
    
    setModal({
      isOpen: true,
      title: 'ยืนยันการลบหมวดหมู่',
      message: 'คุณแน่ใจหรือไม่ที่จะลบหมวดหมู่นี้?',
      type: 'confirm',
      onConfirm: async () => {
        const updatedCategories = categories.filter(c => c.id !== id);
        try {
          const response = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: updatedCategories })
          });
          if (!response.ok) throw new Error('Failed to save categories');
          
          setCategories(updatedCategories);
          if (uploadCategory === id) {
            setUploadCategory(updatedCategories[0]?.id || '');
          }
          closeModal();
        } catch (error) {
          setModal({ isOpen: true, title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถลบหมวดหมู่ได้', type: 'alert' });
        }
      }
    });
  };

  const getCategoryName = (id) => {
    const cat = categories.find(c => c.id === id);
    return cat ? cat.name : id;
  };

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'tiff'].includes(ext)) return <ImageIcon size={16} className="text-[#B11226] mr-2 flex-shrink-0" />;
    if (['mp3', 'wav', 'm4a', 'aac', 'wma'].includes(ext)) return <FileAudio size={16} className="text-[#B11226] mr-2 flex-shrink-0" />;
    if (['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'mpeg'].includes(ext)) return <FileVideo size={16} className="text-[#B11226] mr-2 flex-shrink-0" />;
    return <FileText size={16} className="text-[#B11226] mr-2 flex-shrink-0" />;
  };

  const visibleFiles = files.slice(0, visibleCount);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50 flex flex-col space-y-6 relative">
      
      {/* Stats & Dashboard Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
          <div className="bg-blue-100 p-3 rounded-full mr-4 text-blue-600"><FileArchive size={20} /></div>
          <div>
            <p className="text-xs text-gray-500 font-medium">เอกสารทั้งหมด</p>
            <p className="text-xl font-bold text-[#333333]">{files.length}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
          <div className="bg-green-100 p-3 rounded-full mr-4 text-green-600"><CheckCircle size={20} /></div>
          <div>
            <p className="text-xs text-gray-500 font-medium">ใช้งานอยู่ (Active)</p>
            <p className="text-xl font-bold text-[#333333]">{files.filter(f => f.status === 'active').length}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center">
          <div className="bg-purple-100 p-3 rounded-full mr-4 text-purple-600"><Activity size={20} /></div>
          <div>
            <p className="text-xs text-gray-500 font-medium">สถานะ Vector DB</p>
            <p className="text-xl font-bold text-green-600 text-sm mt-1">Ready (Indexed)</p>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 shrink-0">
        <h3 className="text-md font-semibold text-[#B11226] mb-3 flex items-center">
          <Upload size={18} className="mr-2" /> อัปโหลดเอกสารเข้าสู่ระบบ (รองรับ PDF, Office, Media)
        </h3>
        <div className="flex flex-col sm:flex-row gap-4">
          <div 
            onClick={() => fileInputRef.current?.click()} 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex-1 border-2 border-dashed ${(isDragging || selectedFile) ? 'border-[#B11226] bg-[#fdf2f3]' : 'border-gray-300 hover:bg-gray-50'} rounded-lg p-6 flex flex-col items-center justify-center transition-colors cursor-pointer`}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept={acceptedExtensions}
            />
            {selectedFile ? getFileIcon(selectedFile.name) : <FileText className="text-gray-400 mb-2" size={28} />}
            <p className={`text-sm ${selectedFile ? 'text-[#B11226] font-medium text-center mt-2' : 'text-gray-600 mt-2'}`}>
              {selectedFile ? selectedFile.name : 'คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่'}
            </p>
            <p className="text-xs text-gray-400 mt-2 text-center max-w-xs">รองรับ Document, Image, Audio, Video<br/>(Gemini Multimodal RAG)</p>
          </div>
          
          <div className="sm:w-1/3 flex flex-col space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">หมวดหมู่ของเอกสาร (Category)</label>
              <select 
                value={uploadCategory} 
                onChange={(e) => setUploadCategory(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-[#B11226] focus:border-[#B11226] p-3 sm:p-2.5 outline-none"
              >
                {categories.length === 0 && <option value="" disabled>ไม่มีหมวดหมู่</option>}
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <button 
              onClick={handleUpload}
              disabled={isUploading}
              className={`w-full text-white text-sm font-medium rounded-lg px-4 py-2.5 flex justify-center items-center transition-colors ${
                isUploading ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#B11226] hover:bg-[#8a0e1d] shadow-sm'
              }`}
            >
              {isUploading ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div> กำลังประมวลผล...</>
              ) : showSuccess ? (
                <><CheckCircle size={16} className="mr-2" /> อัปโหลดสำเร็จ</>
              ) : (
                'เริ่มอัปโหลด (Upload & Index)'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Category Management Section */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 shrink-0">
        <h3 className="text-md font-semibold text-[#B11226] mb-3 flex items-center">
          <Tag size={18} className="mr-2" /> จัดการหมวดหมู่เอกสาร (Categories)
        </h3>
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="sm:w-1/3 flex flex-col space-y-2">
            <label className="block text-xs font-medium text-gray-700">เพิ่มหมวดหมู่ใหม่</label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="ชื่อหมวดหมู่..."
                className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-[#B11226] focus:border-[#B11226] p-2.5 sm:p-2 outline-none"
              />
              <button
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim()}
                className="bg-[#333333] hover:bg-black text-white p-2 rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-2">หมวดหมู่ปัจจุบัน (ไม่อนุญาตให้ลบหากมีเอกสารอยู่)</label>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => {
                const isUsed = files.some(f => f.category === cat.id);
                return (
                  <div key={cat.id} className="bg-gray-100 border border-gray-200 rounded-full px-3 py-1 flex items-center text-sm text-gray-700">
                    <span>{cat.name}</span>
                    <button 
                      onClick={() => handleDeleteCategory(cat.id)}
                      className={`ml-2 transition-colors ${isUsed ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                      title={isUsed ? "ไม่สามารถลบได้ มีเอกสารใช้งานอยู่" : "ลบหมวดหมู่"}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
              {categories.length === 0 && <span className="text-sm text-gray-400">ไม่มีหมวดหมู่</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Files Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden shrink-0">
        <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-md font-semibold text-[#333333] flex items-center">
            <Database size={18} className="mr-2 text-[#B11226]" /> ฐานข้อมูลเอกสารของคลินิก (Knowledge Base)
          </h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
            แสดง {visibleFiles.length} จาก {files.length} รายการ
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
              <tr>
                <th className="px-5 py-3 font-medium">ชื่อไฟล์ (File Name)</th>
                <th className="px-5 py-3 font-medium">หมวดหมู่</th>
                <th className="px-5 py-3 font-medium">อัปเดตเมื่อ</th>
                <th className="px-5 py-3 font-medium text-center">สถานะใช้งาน</th>
                <th className="px-5 py-3 font-medium text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {visibleFiles.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-5 py-8 text-center text-gray-400">ไม่มีเอกสารในระบบ</td>
                </tr>
              ) : (
                visibleFiles.map(f => (
                  <tr key={f.id} className="bg-white border-b hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center">
                        {getFileIcon(f.name)}
                        <div>
                          <p className="font-medium text-gray-900 truncate max-w-[200px] sm:max-w-xs">{f.name}</p>
                          <p className="text-xs text-gray-400">{f.size} {f.mimeType ? '(Media/PDF)' : '(Text/Office)'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="bg-gray-100 text-gray-800 text-xs font-medium px-2.5 py-1 rounded">
                        {getCategoryName(f.category)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs">{f.date}</td>
                    <td className="px-5 py-3 text-center">
                      <button 
                        onClick={() => toggleStatus(f.id)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full cursor-pointer transition-colors border ${
                          f.status === 'active' 
                            ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' 
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {f.status === 'active' ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button 
                        onClick={() => deleteFile(f.id)}
                        className="text-gray-400 hover:text-red-600 transition-colors p-1"
                        title="ลบเอกสาร"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Button */}
        {files.length > visibleCount && (
          <div className="p-4 bg-gray-50 flex justify-center border-t border-gray-100">
            <button 
              onClick={() => setVisibleCount(prev => prev + 5)}
              className="text-sm font-medium text-[#B11226] bg-white border border-[#fad4d8] hover:bg-[#fdf2f3] px-6 py-2 rounded-full transition-colors flex items-center shadow-sm"
            >
              แสดงเพิ่มเติม (อีก {files.length - visibleCount} รายการ)
            </button>
          </div>
        )}
      </div>

      {/* Custom Modal for Alerts and Confirms */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className={`px-5 py-4 flex justify-between items-center ${modal.type === 'alert' ? 'bg-amber-500' : 'bg-[#B11226]'}`}>
              <h3 className="text-white font-semibold flex items-center">
                {modal.type === 'alert' ? <AlertTriangle size={18} className="mr-2" /> : <Info size={18} className="mr-2" />}
                {modal.title}
              </h3>
              <button onClick={closeModal} className="text-white/80 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-700 mb-6">{modal.message}</p>
              <div className="flex justify-end space-x-3">
                {modal.type === 'confirm' && (
                  <button onClick={closeModal} className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                    ยกเลิก
                  </button>
                )}
                <button
                  onClick={modal.type === 'confirm' ? modal.onConfirm : closeModal}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${modal.type === 'alert' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-[#B11226] hover:bg-[#8a0e1d]'}`}
                >
                  ตกลง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// --- MAIN COMPONENTS ---
export default function App() {
  const [currentView, setCurrentView] = useState('chat'); // 'chat' | 'admin'
  const [categories, setCategories] = useState([]);
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/data');
        const data = await response.json();
        
        if (response.ok) {
          setFiles(data.files || []);
          setCategories(data.categories || []);
        } else {
          console.error("Server error fetching data:", data.message || data.error);
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      type: 'welcome',
      text: 'สวัสดีครับ ผมคือผู้ช่วย AI ของคลินิก 🏥\nยินดีต้อนรับสู่ระบบช่วยเหลือข้อมูลอัตโนมัติ\n\nคุณสามารถสอบถามข้อมูลต่างๆ เกี่ยวกับบริการของคลินิกได้ทันทีครับ'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [isListening, setIsListening] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const recognitionRef = useRef(null);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (currentView === 'chat') {
      scrollToBottom();
    }
  }, [messages, isTyping, currentView]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'th-TH';
      
      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => setIsListening(false);
      
      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputValue(prev => (prev ? prev + ' ' : '') + transcript);
      };
      
      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };
    }

    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);

  const handleMicClick = () => {
    if (!recognitionRef.current) {
      setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', type: 'system_error', text: 'เบราว์เซอร์ของคุณไม่รองรับการพิมพ์ด้วยเสียง (Speech-to-Text) ครับ กรุณาลองใช้ Chrome' }]);
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  const toggleSpeech = (text, id) => {
    if (!window.speechSynthesis) {
       setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', type: 'system_error', text: 'เบราว์เซอร์ของคุณไม่รองรับการอ่านออกเสียง (Text-to-Speech) ครับ' }]);
       return;
    }
    
    window.speechSynthesis.cancel();
    
    if (speakingId === id) {
      setSpeakingId(null);
      return;
    }
    
    const cleanText = text.replace(/[*_~`#]/g, '');
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'th-TH';
    utterance.rate = 1.0;
    
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  };

  // ฟังก์ชันหลักสำหรับส่งข้อความไปยัง AI
  const processMessage = async (text) => {
    if (!text.trim() || isTyping) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const userMsg = { id: Date.now(), sender: 'user', text: text };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const activeFiles = files.filter(f => f.status === 'active');
      const response = await callGeminiAPI(text, activeFiles);
      
      const botMsg = {
        id: Date.now() + 1,
        sender: 'bot',
        type: response.status || 'answered',
        text: response.answer || 'เกิดข้อผิดพลาดในการประมวลผลคำตอบ',
        short_answer: response.short_answer,
        citations: response.citations,
        conflicts: response.conflicts,
        missing_fields: response.missing_fields
      };
      
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        sender: 'bot',
        type: 'system_error',
        text: 'ขออภัยครับ ระบบประมวลผลขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หรืออาจเป็นเพราะไฟล์แนบมีขนาดใหญ่เกินกว่าที่ API จะรับได้ในครั้งเดียว'
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  // เมื่อผู้ใช้กด Enter หรือกดปุ่ม Submit
  const handleSendMessage = async (e) => {
    e.preventDefault();
    const textToSend = inputValue;
    setInputValue('');
    await processMessage(textToSend);
  };

  const renderBotMessageContent = (msg) => {
    switch (msg.type) {
      case 'welcome':
        return <div className="whitespace-pre-line text-[#333333]">{msg.text}</div>;
        
      case 'answered':
        return (
          <div className="space-y-3">
            {msg.short_answer && (
              <p className="font-semibold text-[#333333] border-b pb-2 border-gray-100">{msg.short_answer}</p>
            )}
            <p className="text-[#333333] whitespace-pre-line">{msg.text}</p>
            
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-4 bg-[#fdf2f3] rounded-md p-3 border border-[#fad4d8] text-sm">
                <div className="flex items-center text-[#B11226] font-medium mb-1">
                  <FileText size={14} className="mr-1.5" />
                  แหล่งอ้างอิงจากคลินิก (Citations)
                </div>
                <ul className="list-none space-y-1.5">
                  {msg.citations.map((cite, idx) => (
                    <li key={idx} className="flex items-start text-[#B11226]/80">
                      <span className="inline-block w-4 text-center mr-1">•</span>
                      <span>
                        <span className="font-medium text-[#8a0e1d]">{cite.file_name}</span> 
                        {cite.locator && <span className="text-xs ml-1 bg-[#fad4d8] px-1.5 py-0.5 rounded text-[#B11226]">{cite.locator}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );

      case 'clarification_needed':
        return (
          <div className="flex items-start space-x-2">
            <Search className="text-orange-500 mt-0.5 flex-shrink-0" size={18} />
            <p className="text-[#333333]">{msg.text}</p>
          </div>
        );

      case 'out_of_scope':
        return (
          <div className="bg-red-50 p-3 rounded-md border border-red-100">
            <div className="flex items-center text-[#B11226] font-semibold mb-1">
              <ShieldAlert size={18} className="mr-1.5" />
              นอกเหนือขอบเขตการให้บริการ
            </div>
            <p className="text-[#333333] text-sm">{msg.text}</p>
          </div>
        );

      case 'conflict_detected':
        return (
          <div className="space-y-3">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
              <p className="text-[#333333]">{msg.text}</p>
            </div>
            {msg.conflicts && (
              <div className="bg-amber-50 p-3 rounded-md border border-amber-200 text-sm">
                <p className="font-semibold text-amber-800 mb-2">ข้อมูลที่พบความขัดแย้ง:</p>
                {msg.conflicts.map((conflict, idx) => (
                  <div key={idx} className="mb-2 last:mb-0">
                    <p className="font-medium text-amber-900">• {conflict.field}</p>
                    <ul className="pl-4 mt-1 space-y-1">
                      {conflict.values.map((val, vIdx) => (
                        <li key={vIdx} className="text-amber-700 text-xs">
                          - {val} <span className="text-amber-500">(จาก: {conflict.sources[vIdx]})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'no_answer':
        return (
          <div className="flex items-start space-x-2">
            <Info className="text-[#B11226] mt-0.5 flex-shrink-0" size={18} />
            <p className="text-[#333333]">{msg.text}</p>
          </div>
        );

      default:
        return <p className="text-[#333333]">{msg.text}</p>;
    }
  };

  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (adminPassword === 'Admin') {
      setCurrentView('admin');
      setShowAuthModal(false);
      setAdminPassword('');
      setAuthError('');
    } else {
      setAuthError('รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 sm:py-6 sm:px-4 md:px-6 lg:px-8 font-sans flex justify-center sm:items-center text-[#333333] relative">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-4 border-[#B11226] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium">กำลังเชื่อมต่อ Vercel Storage...</p>
        </div>
      ) : (
        <>
          <div className={`w-full bg-white sm:rounded-xl sm:shadow-xl overflow-hidden flex flex-col h-[100dvh] sm:h-[85vh] transition-all duration-300 ${currentView === 'admin' ? 'max-w-4xl' : 'max-w-2xl'}`}>
        
        {/* Header */}
        <div className="bg-[#B11226] px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
            {currentView === 'admin' ? (
              <button onClick={() => setCurrentView('chat')} className="text-white hover:bg-[#8a0e1d] p-1.5 rounded-full transition-colors mr-1 shrink-0">
                <ArrowLeft size={20} />
              </button>
            ) : (
              <div className="bg-white p-1.5 sm:p-2 rounded-full flex items-center justify-center shadow-sm shrink-0">
                <Bot size={20} className="text-[#B11226] sm:w-6 sm:h-6" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-white font-bold text-base sm:text-lg leading-tight truncate">
                {currentView === 'admin' ? 'Knowledge Management' : 'Clinic AI Assistant'}
              </h1>
              <p className="text-[#fad4d8] text-[10px] sm:text-xs flex items-center mt-0.5 truncate">
                {currentView === 'admin' ? (
                  <><Database size={10} className="mr-1 shrink-0" /> ระบบจัดการฐานความรู้หลังบ้าน</>
                ) : (
                  <><Clock size={10} className="mr-1 shrink-0" /> Source-Grounded RAG System</>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0 ml-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-white text-xs font-medium pl-1 hidden sm:inline-block">Online</span>
            
            {currentView === 'chat' && (
              <button 
                onClick={() => setShowAuthModal(true)}
                className="ml-4 bg-[#8a0e1d] text-white p-2 rounded-full hover:bg-white hover:text-[#B11226] transition-colors shadow-sm border border-[#8a0e1d] hover:border-transparent"
                title="ระบบจัดการหลังบ้าน (Admin)"
              >
                <Settings size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Body Area */}
        {currentView === 'admin' ? (
          <AdminPanel files={files} setFiles={setFiles} categories={categories} setCategories={setCategories} />
        ) : (
          <>
            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gray-50/50">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex max-w-[85%] ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    
                    {/* Avatar */}
                    <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center overflow-hidden ${
                      msg.sender === 'user' ? 'bg-gray-200 ml-3' : 'bg-[#fad4d8] mr-3'
                    }`}>
                      {msg.sender === 'user' ? (
                        <User size={16} className="text-gray-600" />
                      ) : (
                        <Bot size={18} className="text-[#B11226]" />
                      )}
                    </div>

                    {/* Message Bubble */}
                    <div className={`relative flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`px-4 py-3 rounded-2xl shadow-sm ${
                        msg.sender === 'user' 
                          ? 'bg-[#B11226] text-white rounded-tr-sm' 
                          : 'bg-white border border-gray-100 rounded-tl-sm'
                      }`}>
                        {msg.sender === 'user' ? (
                          <p className="whitespace-pre-line">{msg.text}</p>
                        ) : (
                          renderBotMessageContent(msg)
                        )}
                      </div>
                      
                      {msg.sender === 'bot' && (
                        <div className="flex items-center space-x-2 mt-1.5 ml-1">
                          <button 
                            onClick={() => toggleSpeech(msg.text, msg.id)} 
                            className={`transition-colors p-1 ${speakingId === msg.id ? 'text-[#B11226]' : 'text-gray-400 hover:text-[#B11226]'}`}
                            title={speakingId === msg.id ? 'หยุดอ่านเสียง' : 'อ่านออกเสียง'}
                          >
                            {speakingId === msg.id ? <VolumeX size={14} /> : <Volume2 size={14} />}
                          </button>
                          
                          {msg.type === 'answered' && msg.id !== 1 && (
                            <>
                              <button className="text-gray-400 hover:text-green-600 transition-colors p-1" title="คำตอบถูกต้อง">
                                <ThumbsUp size={14} />
                              </button>
                              <button className="text-gray-400 hover:text-[#B11226] transition-colors p-1" title="ข้อมูลผิดพลาด/คำตอบไม่ตรง">
                                <ThumbsDown size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="flex flex-row max-w-[80%]">
                    <div className="flex-shrink-0 h-8 w-8 rounded-full bg-[#fad4d8] mr-3 flex items-center justify-center overflow-hidden">
                      <Bot size={18} className="text-[#B11226]" />
                    </div>
                    <div className="bg-white border border-gray-100 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm flex items-center space-x-1.5">
                      <div className="w-2 h-2 bg-[#B11226] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-[#B11226] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-[#B11226] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      <span className="text-xs text-gray-500 ml-2">กำลังค้นหาข้อมูลจากเอกสารคลินิก...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="bg-white border-t border-gray-200 flex flex-col shrink-0">

              {/* Chat Form */}
              <div className="p-4 pb-6 sm:pb-4">
                <form onSubmit={handleSendMessage} className="flex space-x-2 relative">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder={isListening ? "กำลังฟัง..." : "สอบถามข้อมูลวัคซีน ราคา หรือเวลาทำการ..."}
                      className={`w-full bg-gray-100 border-transparent rounded-full pl-5 pr-12 py-3 sm:py-3 outline-none transition-all text-base sm:text-sm text-[#333333] ${
                        isListening ? 'ring-2 ring-red-400 bg-red-50' : 'focus:bg-white focus:ring-2 focus:ring-[#B11226]'
                      }`}
                      disabled={isTyping}
                    />
                    <button
                      type="button"
                      onClick={handleMicClick}
                      disabled={isTyping}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all ${
                        isListening ? 'text-[#B11226] bg-[#fad4d8] animate-pulse' : 'text-gray-400 hover:text-[#B11226] hover:bg-gray-200'
                      }`}
                      title="พิมพ์ด้วยเสียง"
                    >
                      <Mic size={18} />
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={!inputValue.trim() || isTyping}
                    className={`rounded-full px-4 py-2 flex items-center justify-center transition-all ${
                      inputValue.trim() && !isTyping 
                        ? 'bg-[#B11226] text-white hover:bg-[#8a0e1d] shadow-md hover:shadow-lg' 
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Send size={18} className={inputValue.trim() && !isTyping ? 'ml-0.5' : ''} />
                  </button>
                </form>
                <div className="text-center mt-2">
                  <p className="text-[10px] text-gray-400">
                    ระบบตอบคำถามโดยอ้างอิงจากฐานข้อมูลเอกสารของคลินิกเท่านั้น (Strict Source-Grounded)
                  </p>
                </div>
              </div>

            </div>
          </>
        )}
      </div>

          {/* Admin Authentication Modal */}
          {showAuthModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="bg-[#B11226] px-5 py-4 flex justify-between items-center">
                  <h3 className="text-white font-semibold flex items-center">
                    <Lock size={18} className="mr-2" /> เข้าสู่ระบบหลังบ้าน
                  </h3>
                  <button 
                    onClick={() => { setShowAuthModal(false); setAuthError(''); setAdminPassword(''); }}
                    className="text-white/80 hover:text-white transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                <form onSubmit={handleAdminLogin} className="p-6">
                  <p className="text-sm text-gray-600 mb-4">
                    กรุณาใส่รหัสผ่านสำหรับเจ้าหน้าที่เพื่อเข้าจัดการฐานข้อมูล
                  </p>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="รหัสผ่าน"
                    className={`w-full bg-gray-50 border ${authError ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#B11226]'} text-gray-900 text-base sm:text-sm rounded-lg p-3 sm:p-2.5 outline-none focus:ring-2 focus:border-transparent mb-2 transition-colors`}
                    autoFocus
                  />
                  {authError && <p className="text-red-500 text-xs mb-4">{authError}</p>}
                  <button 
                    type="submit"
                    className="w-full bg-[#B11226] hover:bg-[#8a0e1d] text-white font-medium rounded-lg text-sm px-5 py-2.5 mt-2 transition-colors"
                  >
                    ยืนยัน (Login)
                  </button>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
