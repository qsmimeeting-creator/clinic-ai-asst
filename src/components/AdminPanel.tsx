import React, { useState, useRef } from 'react';
import { 
  Upload, FileText, Trash2, Activity, FileArchive, CheckCircle, 
  Plus, Tag, X, Image, Music, Video, File, FileSpreadsheet,
  AlertCircle, Info, ChevronDown, ChevronUp, ToggleLeft, ToggleRight
} from 'lucide-react';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

interface AdminPanelProps {
  files: any[];
  setFiles: React.Dispatch<React.SetStateAction<any[]>>;
  categories: any[];
  setCategories: React.Dispatch<React.SetStateAction<any[]>>;
}

const AdminPanel = ({ files, setFiles, categories, setCategories }: AdminPanelProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState(categories[0]?.id || '');
  const [showSuccess, setShowSuccess] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm';
    onConfirm: (() => void) | null;
  }>({ isOpen: false, title: '', message: '', type: 'alert', onConfirm: null });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);

  const getCategoryName = (id: string) => {
    const cat = categories.find(c => c.id === id);
    return cat ? cat.name : 'ทั่วไป';
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return <Image size={18} className="text-blue-500" />;
    if (['mp3', 'wav', 'm4a'].includes(ext)) return <Music size={18} className="text-purple-500" />;
    if (['mp4', 'avi', 'mov'].includes(ext)) return <Video size={18} className="text-red-500" />;
    if (['pdf'].includes(ext)) return <FileText size={18} className="text-red-600" />;
    if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet size={18} className="text-green-600" />;
    if (['doc', 'docx'].includes(ext)) return <FileText size={18} className="text-blue-600" />;
    return <File size={18} className="text-gray-500" />;
  };

  const acceptedExtensions = ".pdf,.xls,.xlsx,.csv,.ppt,.pptx,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp,.tiff,.mp3,.wav,.m4a,.aac,.wma,.mp4,.avi,.mov,.mkv,.wmv,.flv,.mpeg";

  const closeModal = () => setModal({ ...modal, isOpen: false });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const processUploadedFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const arrayBuffer = await file.arrayBuffer();
    
    const base64Data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          resolve(result.split(',')[1]);
        }
      };
      reader.readAsDataURL(file);
    });

    if (['txt', 'csv'].includes(ext)) {
      const content = await file.text();
      return { type: 'text', content, inlineData: base64Data, mimeType: 'text/plain' };
    } 
    else if (['doc', 'docx'].includes(ext)) {
      try {
        const result = await mammoth.extractRawText({ arrayBuffer });
        return { 
          type: 'text', 
          content: result.value,
          inlineData: base64Data,
          mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
      } catch (e) {
        return { type: 'text', content: `[Error reading Word file: ${file.name}]`, inlineData: base64Data, mimeType: file.type };
      }
    }
    else if (['xls', 'xlsx'].includes(ext)) {
      try {
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        let content = "";
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          content += `--- Sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(worksheet)}\n`;
        });
        return { 
          type: 'text', 
          content,
          inlineData: base64Data,
          mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };
      } catch (e) {
        return { type: 'text', content: `[Error reading Excel file: ${file.name}]`, inlineData: base64Data, mimeType: file.type };
      }
    }
    else {
      let mimeType = file.type;
      if (!mimeType) {
        const mimeMap: Record<string, string> = {
          'pdf': 'application/pdf',
          'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'tiff': 'image/tiff',
          'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'aac': 'audio/aac', 'wma': 'audio/x-ms-wma',
          'mp4': 'video/mp4', 'avi': 'video/x-msvideo', 'mov': 'video/quicktime', 'mkv': 'video/x-matroska', 'wmv': 'video/x-ms-wmv', 'flv': 'video/x-flv', 'mpeg': 'video/mpeg'
        };
        mimeType = mimeMap[ext] || 'application/octet-stream';
      }
      return { type: 'media', mimeType: mimeType, inlineData: base64Data };
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setModal({ isOpen: true, title: 'แจ้งเตือน', message: 'กรุณาคลิกเพื่อเลือกไฟล์เอกสารก่อนทำการอัปโหลดครับ', type: 'alert', onConfirm: null });
      return;
    }

    const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB
    if (selectedFile.size > MAX_FILE_SIZE) {
      setModal({ 
        isOpen: true, 
        title: 'ไฟล์ใหญ่เกินไป', 
        message: 'ขนาดไฟล์ต้องไม่เกิน 3MB เนื่องจากข้อจำกัดของระบบอัปโหลดผ่านมือถือ กรุณาเลือกไฟล์ที่เล็กลง', 
        type: 'alert',
        onConfirm: null
      });
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
      
      setFiles(prev => [result, ...prev]);
      setShowSuccess(true);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error: any) {
      setModal({ 
        isOpen: true, 
        title: 'เกิดข้อผิดพลาด', 
        message: `ไม่สามารถอัปโหลดไฟล์ได้: ${error.message}`, 
        type: 'alert',
        onConfirm: null
      });
    } finally {
      setIsUploading(false);
    }
  };

  const toggleStatus = async (id: string) => {
    // Optimistic Update
    const originalFiles = [...files];
    setFiles(files.map(f => f.id === id ? { ...f, status: f.status === 'active' ? 'inactive' : 'active' } : f));

    try {
      const response = await fetch(`/api/files/${id}/status`, { method: 'POST' });
      if (!response.ok) throw new Error('Toggle failed');
    } catch (error) {
      setFiles(originalFiles);
      setModal({ isOpen: true, title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถเปลี่ยนสถานะไฟล์ได้', type: 'alert', onConfirm: null });
    }
  };

  const deleteFile = async (id: string) => {
    setModal({
      isOpen: true,
      title: 'ยืนยันการลบเอกสาร',
      message: 'คุณแน่ใจหรือไม่ที่จะลบไฟล์นี้ออกจาก Vercel Storage? (ไม่สามารถกู้คืนได้)',
      type: 'confirm',
      onConfirm: async () => {
        // Optimistic Update
        const originalFiles = [...files];
        setFiles(files.filter(f => f.id !== id));
        closeModal();

        try {
          const response = await fetch(`/api/files/${id}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Delete failed');
        } catch (error) {
          setFiles(originalFiles);
          setModal({ isOpen: true, title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถลบไฟล์ได้', type: 'alert', onConfirm: null });
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
      setModal({ isOpen: true, title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถบันทึกหมวดหมู่ได้', type: 'alert', onConfirm: null });
    }
  };

  const handleDeleteCategory = async (id: string) => {
    const isUsed = files.some(f => f.category === id);
    if (isUsed) {
      setModal({
        isOpen: true,
        title: 'ไม่สามารถลบได้',
        message: 'ไม่สามารถลบหมวดหมู่นี้ได้ เนื่องจากมีเอกสารในระบบกำลังใช้งานอยู่ กรุณาลบเอกสารที่เกี่ยวข้องออกก่อนครับ',
        type: 'alert',
        onConfirm: null
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
          setModal({ isOpen: true, title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถลบหมวดหมู่ได้', type: 'alert', onConfirm: null });
        }
      }
    });
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

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column: Upload & Categories */}
        <div className="lg:w-1/3 flex flex-col space-y-6 shrink-0">
          {/* Upload Section */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-md font-semibold text-[#B11226] mb-3 flex items-center">
              <Upload size={18} className="mr-2" /> อัปโหลดเอกสาร
            </h3>
            <div className="flex flex-col space-y-4">
              <div 
                onClick={() => fileInputRef.current?.click()} 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed ${(isDragging || selectedFile) ? 'border-[#B11226] bg-[#fdf2f3]' : 'border-gray-300 hover:bg-gray-50'} rounded-lg p-6 flex flex-col items-center justify-center transition-colors cursor-pointer`}
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
                  {selectedFile ? selectedFile.name : 'คลิกเพื่อเลือกไฟล์'}
                </p>
              </div>
              
              <div className="flex flex-col space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">หมวดหมู่</label>
                  <select 
                    value={uploadCategory} 
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-[#B11226] focus:border-[#B11226] p-2.5 outline-none"
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
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div> กำลังอัปโหลด...</>
                  ) : showSuccess ? (
                    <><CheckCircle size={16} className="mr-2" /> สำเร็จ</>
                  ) : (
                    'เริ่มอัปโหลด'
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Category Management Section */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-md font-semibold text-[#B11226] mb-3 flex items-center">
              <Tag size={18} className="mr-2" /> จัดการหมวดหมู่
            </h3>
            <div className="flex flex-col space-y-4">
              <div className="flex flex-col space-y-2">
                <label className="block text-xs font-medium text-gray-700">เพิ่มหมวดหมู่ใหม่</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="ชื่อหมวดหมู่..."
                    className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-[#B11226] focus:border-[#B11226] p-2 outline-none"
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
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">หมวดหมู่ปัจจุบัน</label>
                <div className="flex flex-wrap gap-2">
                  {categories.map(cat => {
                    const isUsed = files.some(f => f.category === cat.id);
                    return (
                      <div key={cat.id} className="bg-gray-100 border border-gray-200 rounded-full px-3 py-1 flex items-center text-xs text-gray-700">
                        <span>{cat.name}</span>
                        <button 
                          onClick={() => handleDeleteCategory(cat.id)}
                          className={`ml-2 transition-colors ${isUsed ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: File List */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-gray-800">รายการเอกสารในระบบ (File Management)</h3>
              <span className="text-xs text-gray-400">แสดง {visibleFiles.length} จาก {files.length} รายการ</span>
            </div>
            
            <div className="p-4 overflow-y-auto">
              {files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <FileArchive size={48} className="mb-3 opacity-20" />
                  <p>ยังไม่มีเอกสารในระบบ</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleFiles.map(file => (
                    <div key={file.id} className={`p-4 rounded-xl border transition-all ${file.status === 'active' ? 'bg-white border-gray-100 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-70'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-3">
                          <div className="mt-1">{getFileIcon(file.name)}</div>
                          <div>
                            <h4 className="font-medium text-gray-900 text-sm sm:text-base break-all">{file.name}</h4>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                              <span className="text-xs text-gray-500 flex items-center"><Tag size={12} className="mr-1" /> {getCategoryName(file.category)}</span>
                              <span className="text-xs text-gray-500 flex items-center"><Activity size={12} className="mr-1" /> {file.size}</span>
                              <span className="text-xs text-gray-500">{file.date}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 sm:space-x-2">
                          <button 
                            onClick={() => toggleStatus(file.id)}
                            className={`p-2 rounded-lg transition-colors ${file.status === 'active' ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                            title={file.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}
                          >
                            {file.status === 'active' ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                          </button>
                          <button 
                            onClick={() => deleteFile(file.id)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="ลบเอกสาร"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {files.length > visibleCount && (
                    <button 
                      onClick={() => setVisibleCount(prev => prev + 5)}
                      className="w-full py-3 text-sm text-gray-500 hover:text-[#B11226] flex items-center justify-center transition-colors"
                    >
                      โหลดเพิ่มอีก 5 รายการ <ChevronDown size={16} className="ml-1" />
                    </button>
                  )}
                  
                  {visibleCount > 5 && (
                    <button 
                      onClick={() => setVisibleCount(5)}
                      className="w-full py-1 text-xs text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors"
                    >
                      ย่อรายการ <ChevronUp size={14} className="ml-1" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Overlay */}
      {modal.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center space-x-3 mb-4">
              <div className={`p-2 rounded-full ${modal.type === 'confirm' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}`}>
                <AlertCircle size={24} />
              </div>
              <h3 className="text-lg font-bold text-gray-900">{modal.title}</h3>
            </div>
            <p className="text-gray-600 mb-6">{modal.message}</p>
            <div className="flex space-x-3">
              {modal.type === 'confirm' ? (
                <>
                  <button onClick={closeModal} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">ยกเลิก</button>
                  <button onClick={modal.onConfirm || closeModal} className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-sm">ยืนยันการลบ</button>
                </>
              ) : (
                <button onClick={closeModal} className="w-full px-4 py-2 bg-[#333333] text-white rounded-lg hover:bg-black transition-colors">ตกลง</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
