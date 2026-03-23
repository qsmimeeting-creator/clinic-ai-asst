import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, Settings, ArrowLeft, Database, Mic } from 'lucide-react';

// Modularized Components
import AdminPanel from './components/AdminPanel';
import AuthModal from './components/AuthModal';
import ChatPanel from './components/ChatPanel';
import ErrorBoundary from './components/ErrorBoundary';

// --- REAL AI BACKEND (Using Gemini API with Context Stuffing & Multimodal) ---
// callGeminiAPI removed and integrated into processMessage for streaming support

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

  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <div className="min-h-screen bg-gray-100 sm:py-6 sm:px-4 md:px-6 lg:px-8 font-sans flex justify-center sm:items-center text-[#333333] relative">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-4 border-[#B11226] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium">กำลังเชื่อมต่อ Vercel Storage...</p>
        </div>
      ) : (
        <>
          <div className={`w-full bg-white sm:rounded-xl sm:shadow-xl overflow-hidden flex flex-col h-[100dvh] sm:h-[85vh] transition-all duration-300 ${currentView === 'admin' ? 'max-w-6xl' : 'max-w-2xl'}`}>
        
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
                {currentView === 'admin' && (
                  <><Database size={10} className="mr-1 shrink-0" /> ระบบจัดการฐานความรู้หลังบ้าน</>
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
          <AdminPanel 
            files={files} 
            setFiles={setFiles} 
            categories={categories} 
            setCategories={setCategories}
          />
        ) : (
          <ChatPanel files={files} />
        )}
      </div>

          {/* Admin Authentication Modal */}
          <AuthModal 
            showAuthModal={showAuthModal}
            setShowAuthModal={setShowAuthModal}
            onSuccess={() => setCurrentView('admin')}
          />
        </>
      )}
    </div>
  );
}
